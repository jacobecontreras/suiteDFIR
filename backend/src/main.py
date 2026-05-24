import os
import sys
import asyncio
import logging

# On Windows, the ProactorEventLoop is required for subprocess support
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

# Ensure src directory is in Python path for imports
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

load_dotenv()
from core.logger import setup_logging
from core.database import init_database
from core.config import BASE_DIR

# Enable auto-reload in development mode only (set by Electron)
IS_DEV = os.environ.get('SUITEDFIR_DEV', 'false').lower() == 'true'

from services.plugin_manager import load_plugins
from api import cases, reports, profiles, dashboard, processing, backups, system, tools, settings, tiles, db_viewer, case_exports, photos
from utils.device_watcher import start_device_watcher, stop_device_watcher
from services.case_manager import case_manager

# Setup logging
log_level = logging.INFO
setup_logging(level=log_level)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize all configured forensic tool plugins on startup"""
    # Init database
    init_database()
    logger.info("Database initialized")

    # Init each tool
    load_plugins()
    
    # Start device watcher for real-time iOS device detection
    loop = asyncio.get_running_loop()
    logger.info(f"Using event loop: {loop.__class__.__name__}")
    await start_device_watcher()
    logger.info("Device watcher started")
    
    # Run orphaned file cleanup sweep
    asyncio.create_task(case_manager.cleanup_orphaned_files())
    
    yield
    
    # Cleanup on shutdown
    await stop_device_watcher()
    logger.info("Device watcher stopped")

app = FastAPI(lifespan=lifespan)

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    from fastapi import HTTPException
    from starlette.exceptions import HTTPException as StarletteHTTPException
    
    # Allow explicit HTTPExceptions to pass through with their status code
    if isinstance(exc, (HTTPException, StarletteHTTPException)):
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
        )

    # For everything else, log it and return 500
    logger.error(f"Unhandled error: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal Server Error: {str(exc)}"},
    )

# Configure CORS - MUST be before route registration so middleware wraps all handlers
# Restrict to the Electron app's actual origins: app:// in prod, Vite dev server in dev.
_allowed_origins = ["http://localhost:3000"] if IS_DEV else ["app://."]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept"],
)

# Include Routers
app.include_router(system.router)
app.include_router(cases.router)
app.include_router(reports.router)
app.include_router(profiles.router)
app.include_router(dashboard.router)
app.include_router(processing.router)
app.include_router(backups.router)
app.include_router(tools.router)
app.include_router(settings.router)
app.include_router(tiles.router)
app.include_router(db_viewer.router)
app.include_router(case_exports.router)
app.include_router(photos.router)

from core.config import TOOLS_CONFIG, REPORTS_DIR, BACKUPS_DIR, TOOLS_DIR, DATA_DIR, PHOTOS_DIR

# Ensure required directories exist
IMPORTS_DIR = os.path.join(DATA_DIR, "imports")
for d in [REPORTS_DIR, BACKUPS_DIR, TOOLS_DIR, IMPORTS_DIR, PHOTOS_DIR]:
    if not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

# Mount static directories
app.mount("/reports", StaticFiles(directory=REPORTS_DIR), name="reports")
app.mount("/imports", StaticFiles(directory=IMPORTS_DIR), name="imports")
app.mount("/photos", StaticFiles(directory=PHOTOS_DIR), name="photos")

if __name__ == "__main__":
    import sys
    import argparse
    import uvicorn
    
    # Wrapper mode for running external scripts like iLEAPP in bundled environment
    if "--wrapper" in sys.argv:
        import importlib.util
        wrapper_idx = sys.argv.index("--wrapper")
        script_path = sys.argv[wrapper_idx + 1]
        
        # Setup environment for the script
        sys.path.insert(0, os.path.dirname(script_path))
        
        # Force unbuffered stdout/stderr
        # This is critical for real-time log streaming in the bundled app
        try:
            sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)
            sys.stderr.reconfigure(encoding='utf-8', line_buffering=True)
        except AttributeError:
             pass # In case not available, though Python 3.12 supports it
        
        # Force Pure-Python Protobuf implementation
        # This avoids C++ descriptor pool issues in frozen environments
        os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'
        
        # Adjust sys.argv to look like standard script execution for the tool
        # Example: [suitedfir-backend, --wrapper, tool.py, -i, input] -> [tool.py, -i, input]
        sys.argv = sys.argv[wrapper_idx + 1:]
        
        try:
            spec = importlib.util.spec_from_file_location("__main__", script_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            sys.exit(0)
        except SystemExit as e:
            sys.exit(e.code)
        except Exception as e:
            import traceback
            logger.error(f"Wrapper execution failed: {e}")
            traceback.print_exc()
            sys.exit(1)

    # Parse CLI arguments for port
    parser = argparse.ArgumentParser(description="suiteDFIR Backend")
    parser.add_argument('--port', type=int, default=8000, help='Port to run the server on')
    args = parser.parse_args()

    # In bundled PyInstaller app, use app object directly
    # In development, use module string for reload support
    is_bundled = getattr(sys, 'frozen', False)
    
    # Bind to loopback only — the backend is local to the Electron app and must
    # not be reachable from other hosts on the network.
    BIND_HOST = "127.0.0.1"

    if args.port == 0:
        # Dynamic port allocation: bind to 0 to find a free port, then close and let Uvicorn bind
        # This avoids passing file descriptors which is problematic on Windows (AF_UNIX error)
        import socket
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind((BIND_HOST, 0))
        port = sock.getsockname()[1]
        sock.close()

        # Vital: Print the port so Electron can read it
        print(f"SUITEDFIR_BACKEND_PORT:{port}", flush=True)

        # Run Uvicorn with the explicit port
        if is_bundled:
            # Production: use in-memory app object, no reload
            uvicorn.run(app, host=BIND_HOST, port=port)
        else:
            # Development: use module string for reload, gated by IS_DEV
            # Use src.main:app for correct module resolution in reload subprocesses
            app_module = "src.main:app" if IS_DEV else "main:app"
            uvicorn.run(app_module, host=BIND_HOST, port=port, reload=IS_DEV)
    else:
        # Standard port binding
        if is_bundled:
            # Production: use in-memory app object, no reload
            uvicorn.run(app, host=BIND_HOST, port=args.port)
        else:
            # Development: use module string for reload, gated by IS_DEV
            # Use src.main:app for correct module resolution in reload subprocesses
            app_module = "src.main:app" if IS_DEV else "main:app"
            uvicorn.run(app_module, host=BIND_HOST, port=args.port, reload=IS_DEV)
