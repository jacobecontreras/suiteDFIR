import os
import asyncio
import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()
from logger import setup_logging
from database import init_database
from config import TOOLS_CONFIG, REPORTS_DIR

from plugin_manager import load_plugins
from routers import cases, reports, profiles, tasks, processing, backups, system, timeline, tools
from device_watcher import start_device_watcher, stop_device_watcher
from utils import get_operating_system

# Setup logging
setup_logging()
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
    await start_device_watcher()
    logger.info("Device watcher started")
    
    # Log Operating System
    os_info = get_operating_system()
    logger.info(f"Operating System: {os_info['platform']}")
    
    yield
    
    # Cleanup on shutdown
    await stop_device_watcher()
    logger.info("Device watcher stopped")

app = FastAPI(lifespan=lifespan)

# Include Routers
app.include_router(system.router)
app.include_router(cases.router)
app.include_router(reports.router)
app.include_router(profiles.router)
app.include_router(tasks.router)
app.include_router(processing.router)
app.include_router(backups.router)
app.include_router(timeline.router)
app.include_router(tools.router)


# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure reports directory exists
if not os.path.exists(REPORTS_DIR):
    os.makedirs(REPORTS_DIR)

# Mount the root reports directory to serve report files
app.mount("/reports", StaticFiles(directory=REPORTS_DIR), name="reports")

if __name__ == "__main__":
    import sys
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
            sys.stdout.reconfigure(line_buffering=True)
            sys.stderr.reconfigure(line_buffering=True)
        except AttributeError:
             pass # In case not available, though Python 3.12 supports it
        
        # Force Pure-Python Protobuf implementation
        # This avoids C++ descriptor pool issues in frozen environments
        os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'
        
        # Adjust sys.argv to look like standard script execution for the tool
        # Example: [vdf-backend, --wrapper, tool.py, -i, input] -> [tool.py, -i, input]
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
            print(f"Wrapper execution failed: {e}", file=sys.stderr)
            traceback.print_exc()
            sys.exit(1)

    # In bundled PyInstaller app, use app object directly
    # In development, use module string for reload support
    is_bundled = getattr(sys, 'frozen', False)
    
    if is_bundled:
        # Production: pass app object directly, no reload
        uvicorn.run(app, host="0.0.0.0", port=8000)
    else:
        # Development: use module string for hot reload
        uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)