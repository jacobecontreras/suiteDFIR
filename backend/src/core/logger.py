import logging
import logging.handlers
import os
import sys
import platform
import tempfile
from pathlib import Path

def get_log_directory() -> Path:
    """Get a writable directory for log files"""
    # Check if running as bundled PyInstaller app
    if getattr(sys, 'frozen', False):
        # Running as bundled executable
        # Use user's home directory for logs
        if platform.system() == "Darwin":
            log_dir = Path.home() / 'Library' / 'Logs' / 'VDF Tools'
        elif platform.system() == "Windows":
            app_data = os.environ.get('APPDATA')
            base = Path(app_data) if app_data else Path(tempfile.gettempdir())
            log_dir = base / 'VDF Tools' / 'Logs'
        else:
            log_dir = Path.home() / '.vdf-tools' / 'logs'
    else:
        # Running in development - use current directory
        log_dir = Path(__file__).parent.resolve()
    
    # Ensure directory exists
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir

def setup_logging(log_file: Path = None, level=logging.INFO):
    """Backend logging system"""
    # Determine log file path
    if log_file is None:
        log_dir = get_log_directory()
        log_file = log_dir / 'backend.log'
    else:
        log_file = Path(log_file)
    
    # Create logger
    logger = logging.getLogger()
    logger.setLevel(level)

    try:
        # Use RotatingFileHandler to cap file size at 50MB and keep 3 backups
        file_handler = logging.handlers.RotatingFileHandler(
            log_file, 
            maxBytes=50 * 1024 * 1024, # 50MB
            backupCount=3
        )
        file_handler.setLevel(level)

        # Create formatter and set it for the handler
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        file_handler.setFormatter(formatter)

        # Remove any existing handlers
        if logger.hasHandlers():
            logger.handlers.clear()

        # Add file handler to logger
        logger.addHandler(file_handler)
        
        logging.info("Logging initialized. Output directed to %s", log_file)
    except Exception as e:
        # Fallback to console-only logging if file access fails
        console_handler = logging.StreamHandler()
        console_handler.setLevel(level)
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        console_handler.setFormatter(formatter)
        
        if logger.hasHandlers():
            logger.handlers.clear()
        logger.addHandler(console_handler)
        
        logging.warning("Failed to create log file at %s: %s. Using console logging.", log_file, e)
