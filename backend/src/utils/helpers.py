import os
import sys
import json
import logging
import asyncio
import subprocess
import importlib.util
import platform
from pathlib import Path
from core.state import event_clients
from core.config import TOOLS_CONFIG
from services.plugin_manager import safe_tool_execution

logger = logging.getLogger(__name__)

def get_size_format(b, factor=1024, suffix="B"):
    """Scale bytes to its proper format"""
    for unit in ["", "K", "M", "G", "T", "P", "E", "Z"]:
        if b < factor:
            return f"{b:.2f}{unit}{suffix}"
        b /= factor
    return f"{b:.2f}Y{suffix}"

def open_in_explorer(path: str) -> None:
    """Open a file or directory in the system's native file explorer."""
    import platform
    import subprocess
    import os

    system = platform.system()
    if system == "Darwin":
        subprocess.run(["open", path])
    elif system == "Windows":
        os.startfile(path)
    else:
        subprocess.run(["xdg-open", path])


def open_path_secured(path: str, allowed_dir: str, resource_name: str = "Resource") -> dict:
    """
    Open a path in the system file explorer with security validation.
    
    Args:
        path: The path to open
        allowed_dir: Base directory that path must be within (security check)
        resource_name: Human-readable name for error messages (e.g., "Backup", "Report")
        
    Returns:
        Dict with 'success' and 'message' on success, or 'error' and 'status_code' on failure
    """
    # Security check: ensure path is within allowed directory
    from utils.fs_ops import FileOperations
    if not FileOperations.validate_path_security(path, allowed_dir):
        return {"error": "Access denied", "status_code": 403}
    
    # Existence check
    if not os.path.exists(path):
        return {"error": f"{resource_name} not found", "status_code": 404}
    
    try:
        open_in_explorer(path)
        return {"success": True, "message": f"{resource_name} opened successfully"}
    except Exception as e:
        return {"error": f"Failed to open {resource_name.lower()}: {str(e)}", "status_code": 500}

def handle_open_path_request(path: str, allowed_dir: str, resource_name: str = "Resource"):
    """
    Wrapper for open_path_secured that raises FastAPI HTTPExceptions.
    Useful for thin routers.
    """
    from fastapi import HTTPException
    
    result = open_path_secured(path, allowed_dir, resource_name)
    
    if "error" in result:
        raise HTTPException(status_code=result["status_code"], detail=result["error"])
    
    return {"message": result["message"]}

def get_binary_path(binary_name):
    """Resolve the absolute path to a bundled helper binary.

    Handles Dev (source) and Prod (frozen) modes. On Linux the binaries are
    split by CPU architecture (bin/linux/{x86_64,arm64}).

    Raises FileNotFoundError if the binary is not in the bundle — never
    returns a bare name, so subprocess can never fall back to $PATH.
    Callers already treat this as a subprocess failure: a bare name that is
    missing from $PATH raises the same exception from subprocess itself.
    """
    # Potential locations for the 'bin' folder
    possible_paths = []

    if getattr(sys, 'frozen', False):
        # --- PRODUCTION (PyInstaller/Electron) ---
        base_dir = os.path.dirname(sys.executable)

        # 1. Standard PyInstaller: inside the one-file temp dir or next to executable
        if hasattr(sys, '_MEIPASS'):
            possible_paths.append(os.path.join(sys._MEIPASS, 'bin'))

        possible_paths.append(os.path.join(base_dir, 'bin'))

        # 2. Electron Structure: The backend is in "suiteDFIR Backend", bin is up one level in "Resources"
        # contents/Resources/suiteDFIR Backend/suitedfir-backend (executable)
        # contents/Resources/bin
        possible_paths.append(os.path.join(base_dir, '..', 'bin'))
        possible_paths.append(os.path.join(base_dir, '..', '..', 'bin')) # Just in case extra nesting

    else:
        # --- DEVELOPMENT ---
        # backend/src/utils/helpers.py -> backend/bin
        # We need to go up two levels from utils (src, then backend) to find bin
        base_dir = os.path.dirname(os.path.abspath(__file__))
        possible_paths.append(os.path.join(base_dir, '..', '..', 'bin'))

    # Determine platform-specific subfolder
    system = platform.system().lower()
    if system == "linux":
        machine = platform.machine().lower()
        if machine in ("x86_64", "amd64"):
            subfolder = os.path.join("linux", "x86_64")
        elif machine in ("aarch64", "arm64"):
            subfolder = os.path.join("linux", "arm64")
        else:
            error_msg = f"No bundled binaries for Linux architecture {platform.machine()!r}"
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)
    elif system == "darwin":
        subfolder = "macos"
    elif system == "windows":
         subfolder = "windows"
         if not binary_name.lower().endswith(".exe"):
             binary_name += ".exe"
    else:
        error_msg = f"No bundled binaries for platform {system!r}"
        logger.error(error_msg)
        raise FileNotFoundError(error_msg)

    # Search
    for p in possible_paths:
        # Construct path: .../bin/{subfolder}/{binary_name}
        full_path = os.path.join(p, subfolder, binary_name)
        if os.path.exists(full_path):
            if os.access(full_path, os.X_OK):
                logger.info(f"Found binary {binary_name} at {full_path}")
                return os.path.abspath(full_path)
            else:
                logger.warning(f"Binary {binary_name} exists at {full_path} but is not executable")

    # Strict mode: no fallback to system PATH.
    error_msg = f"Binary {binary_name} not found in bundle for {system}/{platform.machine()}. Checked paths: {possible_paths}"
    logger.error(error_msg)
    raise FileNotFoundError(error_msg)

def get_subprocess_startupinfo():
    """
    Returns a subprocess.STARTUPINFO object with SW_HIDE flag set
    only if running on Windows. Returns None on other platforms.
    """
    if platform.system() == "Windows":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        return startupinfo
    return None

async def broadcast_event(event_type: str, data: dict):
    """Broadcast event to all connected clients"""
    if not event_clients:
        return
        
    message = json.dumps({"type": event_type, "data": data})
    disconnected_clients = set()
    
    for queue in event_clients:
        try:
            await queue.put(message)
        except Exception as e:
            logger.debug(f"Queue error: {e}")
            disconnected_clients.add(queue)
            
    for client in disconnected_clients:
        event_clients.remove(client)

async def get_device_details(udid: str):
    """Fetch detailed info for an iOS device asynchronously using threads for Windows stability"""
    device_info = {
        "id": udid,
        "udid": udid,
        "name": "iOS Device",
        "type": "ios",
        "device_type": "ios",
        "status": "online",
        "connection": "usb",
        "battery": 100,
        "is_encrypted": False,
        "is_rooted": False
    }

    def run_ideviceinfo(args):
        cmd = [get_binary_path("ideviceinfo")] + args
        return subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', startupinfo=get_subprocess_startupinfo())

    try:
        # Get Device Name
        res = await asyncio.to_thread(run_ideviceinfo, ["-u", udid, "-k", "DeviceName"])
        if res.returncode == 0:
            device_info["name"] = res.stdout.strip()

        # Get Product Type
        res = await asyncio.to_thread(run_ideviceinfo, ["-u", udid, "-k", "ProductType"])
        if res.returncode == 0:
            device_info["device_type"] = res.stdout.strip()

        # Check Encryption
        res = await asyncio.to_thread(run_ideviceinfo, ["-u", udid, "-q", "com.apple.mobile.backup"])
        if res.returncode == 0:
            output = res.stdout
            if "WillEncrypt: true" in output or "RequiresEncryption: 1" in output:
                device_info["is_encrypted"] = True
                
    except Exception as e:
        logger.error(f"Error fetching details for {udid}: {e}")
        
    return device_info

async def get_connected_devices():
    """Helper to get list of connected devices with details using thread-safe calls"""
    devices = []
    
    def list_udids():
        cmd = [get_binary_path("idevice_id"), "-l"]
        return subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', startupinfo=get_subprocess_startupinfo())

    try:
        res = await asyncio.to_thread(list_udids)
        
        if res.returncode == 0:
            udids = res.stdout.strip().splitlines()
            for udid in udids:
                if udid:
                    details = await get_device_details(udid)
                    devices.append(details)
        else:
            logger.error(f"idevice_id failed with return code {res.returncode}: {res.stderr}")
                    
    except Exception as e:
        logger.error(f"Error checking for devices: {e}", exc_info=True)
        
    return devices

async def get_connected_android_devices():
    """Helper to get list of connected Android devices via ADB."""
    devices = []
    
    def list_adb_devices():
        cmd = [get_binary_path("adb"), "devices", "-l"]
        return subprocess.run(cmd, capture_output=True, encoding='utf-8', errors='replace', startupinfo=get_subprocess_startupinfo())

    try:
        res = await asyncio.to_thread(list_adb_devices)
        
        if res.returncode == 0:
            lines = res.stdout.strip().splitlines()
            # Skip the first line ("List of devices attached")
            for line in lines[1:]:
                if not line.strip():
                    continue
                    
                parts = line.split()
                if len(parts) >= 2 and parts[1] == "device":
                    udid = parts[0]
                    
                    # Try to extract the model from the extended list
                    model = "Android Device"
                    for part in parts[2:]:
                        if part.startswith("model:"):
                            model = part[6:].replace("_", " ")
                            break
                            
                    # Check for root access
                    is_rooted = False
                    root_cmd = [get_binary_path("adb"), "-s", udid, "shell", "su", "-c", "id"]
                    root_res = subprocess.run(root_cmd, capture_output=True, encoding='utf-8', errors='ignore', startupinfo=get_subprocess_startupinfo())
                    if root_res.returncode == 0 and "uid=0(root)" in root_res.stdout:
                        is_rooted = True
                        
                    devices.append({
                        "id": udid,
                        "udid": udid,
                        "name": model,
                        "type": "android",
                        "status": "online",
                        "connection": "usb",
                        "battery": 100, # Mock battery for now
                        "is_encrypted": False, # ADB logical pulls aren't "encrypted" backups
                        "is_rooted": is_rooted
                    })
        else:
            logger.error(f"adb devices failed with return code {res.returncode}: {res.stderr}")
                    
    except Exception as e:
        # Ignore errors if ADB isn't installed/present yet
        logger.debug(f"Error checking for android devices (adb might be missing): {e}")
        
    return devices

def check_backup_encryption(path):
    """
    Check if an iTunes backup is encrypted using iLEAPP modules.
    Returns dict with keys: encrypted, type, supported, message (or error)
    """
    # Use configuration instead of hardcoded paths
    ileapp_config = TOOLS_CONFIG.get("ileapp")
    if not ileapp_config:
        return {"error": "iLEAPP configuration not found"}
        
    ileapp_path = ileapp_config["path"]
    
    try:
        # Use safe context manager for tool execution
        with safe_tool_execution(ileapp_path):
            # 1. Force load iLEAPP's ilapfuncs first
            ilapfuncs_path = os.path.join(ileapp_path, 'scripts', 'ilapfuncs.py')
            spec_funcs = importlib.util.spec_from_file_location("scripts.ilapfuncs", ilapfuncs_path)
            ilapfuncs = importlib.util.module_from_spec(spec_funcs)
            # Inject into sys.modules so search_files finds THIS version
            sys.modules["scripts.ilapfuncs"] = ilapfuncs 
            spec_funcs.loader.exec_module(ilapfuncs)
            
            # Silence logging
            ilapfuncs.logfunc = lambda x: None

            # 2. Now load search_files
            search_files_path = os.path.join(ileapp_path, 'scripts', 'search_files.py')
            spec = importlib.util.spec_from_file_location("ileapp_search_files", search_files_path)
            search_files = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(search_files)
            
            get_itunes_backup_type = search_files.get_itunes_backup_type
            check_itunes_backup_status = search_files.check_itunes_backup_status
            
            backup_type = get_itunes_backup_type(path)
            if not backup_type:
                return {"encrypted": False}
            
            supported, encrypted, message = check_itunes_backup_status(path, backup_type)
            
            return {
                "encrypted": encrypted
            }
    except Exception as e:
        logger.error(f"Error checking backup encryption: {e}")
        return {"error": str(e)}
