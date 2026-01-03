import os
import sys
import json
import logging
import asyncio
import importlib.util
from pathlib import Path
import shutil
from state import event_clients
from config import TOOLS_CONFIG
from plugin_manager import safe_tool_execution

logger = logging.getLogger(__name__)

def get_size_format(b, factor=1024, suffix="B"):
    """Scale bytes to its proper format"""
    for unit in ["", "K", "M", "G", "T", "P", "E", "Z"]:
        if b < factor:
            return f"{b:.2f}{unit}{suffix}"
        b /= factor
    return f"{b:.2f}Y{suffix}"

def get_binary_path(binary_name):
    """Resolve path to a binary, preferring bundled versions"""
    # Check if we are running in a bundled app
    if getattr(sys, 'frozen', False):
        # In bundled app, binaries are in the _internal/bin folder
        # sys._MEIPASS is the temp folder for PyInstaller onefile, but for onedir it's adjacent
        base_path = sys._MEIPASS if hasattr(sys, '_MEIPASS') else os.path.dirname(os.path.abspath(__file__))
        bundled_path = os.path.join(base_path, 'bin', binary_name)
        if os.path.exists(bundled_path):
            return bundled_path
            
    # Fallback to system path (just the name)
    return binary_name

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
    """Fetch detailed info for an iOS device asynchronously"""
    device_info = {
        "id": udid,
        "udid": udid,
        "name": "iOS Device",
        "type": "ios",
        "status": "online",
        "connection": "usb",
        "battery": 100,
        "is_encrypted": False
    }

    try:
        # Run ideviceinfo -x (XML) or simple key lookups
        # We'll do key lookups as they are simpler to parse without xmltodict
        
        ideviceinfo_cmd = get_binary_path("ideviceinfo")
        
        # Get Device Name
        proc_name = await asyncio.create_subprocess_exec(
            ideviceinfo_cmd, "-u", udid, "-k", "DeviceName",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout_name, _ = await proc_name.communicate()
        if proc_name.returncode == 0:
            device_info["name"] = stdout_name.decode().strip()

        # Get Product Type
        proc_type = await asyncio.create_subprocess_exec(
            ideviceinfo_cmd, "-u", udid, "-k", "ProductType",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout_type, _ = await proc_type.communicate()
        if proc_type.returncode == 0:
            device_info["type"] = stdout_type.decode().strip()

        # Check Encryption (com.apple.mobile.backup Domain)
        proc_enc = await asyncio.create_subprocess_exec(
            ideviceinfo_cmd, "-u", udid, "-q", "com.apple.mobile.backup",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout_enc, _ = await proc_enc.communicate()
        if proc_enc.returncode == 0:
            output = stdout_enc.decode()
            if "WillEncrypt: true" in output or "RequiresEncryption: 1" in output:
                device_info["is_encrypted"] = True
                
    except Exception as e:
        logger.error(f"Error fetching details for {udid}: {e}")
        
    return device_info

async def get_connected_devices():
    """Helper to get list of connected devices with details"""
    devices = []
    
    # Check for iOS devices using idevice_id
    try:
        idevice_id_cmd = get_binary_path("idevice_id")
        
        # Check if binary exists/is in path (shutil.which is good for this)
        if not shutil.which(idevice_id_cmd):
            # Quietly return empty if tool is missing
            return []

        proc = await asyncio.create_subprocess_exec(
            idevice_id_cmd, "-l",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )

        stdout, _ = await proc.communicate()
        
        if proc.returncode == 0:
            udids = stdout.decode().strip().splitlines()
            for udid in udids:
                if udid:
                    # Get details for each device
                    details = await get_device_details(udid)
                    devices.append(details)
                    
    except Exception as e:
        logger.error(f"Error checking for devices: {e}")
        
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
                return {"encrypted": False, "type": "unknown", "supported": False}
            
            supported, encrypted, message = check_itunes_backup_status(path, backup_type)
            
            return {
                "encrypted": encrypted,
                "type": backup_type,
                "supported": supported,
                "message": message
            }
    except Exception as e:
        logger.error(f"Error checking backup encryption: {e}")
        return {"error": str(e)}

def normalize_report_path(path: str) -> str:
    """
    Normalize report path by handling common case mismatches (e.g., aleapp-reports vs aLEAPP-reports).
    Returns the corrected path if found, otherwise the original path.
    """
    if not path:
        return path
        
    if not os.path.exists(path):
        # Handle case mismatch for aLEAPP reports (legacy or case-sensitive FS issues)
        if 'aLEAPP-reports' in path:
            alt_path = path.replace('aLEAPP-reports', 'aleapp-reports')
            if os.path.exists(alt_path):
                return alt_path
        elif 'aleapp-reports' in path:
            alt_path = path.replace('aleapp-reports', 'aLEAPP-reports')
            if os.path.exists(alt_path):
                return alt_path
                
    return path
