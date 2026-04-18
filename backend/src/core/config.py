import os
import sys
import platform
from pathlib import Path
from typing import Dict, Any

# Environment Configuration


def get_base_dir() -> Path:
    """Get the base directory for persistent data, handling both dev and bundled environments."""
    if getattr(sys, 'frozen', False):
        # Bundled: store in user's Application Support / AppData
        if platform.system() == "Darwin":
            base = Path.home() / "Library" / "Application Support" / "suiteDFIR"
        elif platform.system() == "Windows":
            base = Path.home() / "AppData" / "Local" / "suiteDFIR"
        else:
            base = Path.home() / ".suitedfir"
    else:
        # Development: use backend directory (go up from src/core to backend)
        base = Path(__file__).parent.parent.parent

    return base

BASE_DIR = get_base_dir()


# Tool Configuration
TOOLS_CONFIG: Dict[str, Dict[str, Any]] = {
    "ileapp": {
        "name": "iLEAPP",
        "subdir": "iLEAPP",
        "github_url": "https://github.com/abrignoni/iLEAPP",
        "script": "ileapp.py",
        "profile_ext": ".ilprofile",
        "description": "iOS Logs, Events, And Plist Parser",
        "excluded_modules": {'iTunesBackupInfo', 'last_build', 'logarchive'}
    },
    "aleapp": {
        "name": "aLEAPP",
        "subdir": "ALEAPP",
        "github_url": "https://github.com/abrignoni/ALEAPP",
        "script": "aleapp.py",
        "profile_ext": ".alprofile",
        "description": "Android Logs, Events, And Protobuf Parser",
        "excluded_modules": {'googleMapsSearches', 'notificationHistory'}
    }
}


# Directory Configuration
REPORTS_DIR = str(BASE_DIR / "reports")
BACKUPS_DIR = str(BASE_DIR / "backups")

def get_tools_dir() -> str:
    """Get the directory for forensic tools."""
    if not getattr(sys, 'frozen', False):
        # Development: backend/forensic-tools
        return str(BASE_DIR / "forensic-tools")
    else:
        # Production: Resources/forensic-tools (sibling to suiteDFIR Backend)
        # Structure: Resources/{suiteDFIR Backend, forensic-tools}
        return str(Path(sys.executable).parent.parent / "forensic-tools")

TOOLS_DIR = get_tools_dir()


# Database Configuration
DATA_DIR = str(BASE_DIR / "data")
DB_PATH = str(BASE_DIR / "data" / "app.db")


# Photos Configuration
PHOTOS_DIR = str(BASE_DIR / "data" / "photos")

def get_photogrep_path() -> str:
    """Get the parent directory containing the photogrep package."""
    if getattr(sys, 'frozen', False):
        return str(Path(sys.executable).parent.parent / "forensic-tools" / "photogrep")
    else:
        return str(BASE_DIR / "forensic-tools" / "photogrep")

PHOTOGREP_PATH = get_photogrep_path()

# Cache Configuration
CACHE_DIR = BASE_DIR / "data" / "cache"
COORDS_DB = str(CACHE_DIR / "coordinates.db")
