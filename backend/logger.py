import logging
import os
import sys
import tempfile

def get_log_directory():
    """Get a writable directory for log files"""
    # Check if running as bundled PyInstaller app
    if getattr(sys, 'frozen', False):
        # Running as bundled executable
        # Use user's home directory for logs
        if sys.platform == 'darwin':
            log_dir = os.path.expanduser('~/Library/Logs/VDF Tools')
        elif sys.platform == 'win32':
            log_dir = os.path.join(os.environ.get('APPDATA', tempfile.gettempdir()), 'VDF Tools', 'Logs')
        else:
            log_dir = os.path.expanduser('~/.vdf-tools/logs')
    else:
        # Running in development - use current directory
        log_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Ensure directory exists
    os.makedirs(log_dir, exist_ok=True)
    return log_dir

def setup_logging(log_file=None, level=logging.INFO):
    """Backend logging system"""
    # Determine log file path
    if log_file is None:
        log_dir = get_log_directory()
        log_file = os.path.join(log_dir, 'backend.log')
    
    # Create logger
    logger = logging.getLogger()
    logger.setLevel(level)

    # Create file handler
    try:
        file_handler = logging.FileHandler(log_file)
        file_handler.setLevel(level)

        # Create formatter and set it for the handler
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        file_handler.setFormatter(formatter)

        # Remove any existing handlers
        if logger.hasHandlers():
            logger.handlers.clear()

        # Add file handler to logger
        logger.addHandler(file_handler)
        
        # Add console handler to logger as well
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
        
        logging.info("Logging initialized. Output directed to %s and console", log_file)
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
