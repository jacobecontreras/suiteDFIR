import os
import asyncio
import logging
import platform
import shutil
import subprocess
import psutil
from typing import Optional, List, Dict, Any

from core.config import TOOLS_CONFIG
from core.database import DB_PATH, db_fetch_all
from core.state import available_modules, plugin_loaders
from utils.fs_ops import FileOperations

logger = logging.getLogger(__name__)


class SystemManager:
    """Manages system health, storage metrics, and file dialog operations."""

    async def get_root_info(self) -> Dict[str, Any]:
        """Get root info including total loaded modules."""
        total_modules = sum(len(modules) for modules in available_modules.values())
        return {
            "message": "Forensic Tools Web API is running",
            "tools": list(TOOLS_CONFIG.keys()),
            "modules_loaded": total_modules
        }

    async def get_health_check(self) -> Dict[str, Any]:
        """Get system health status verifying tool initialization."""
        tools_status = {tool: len(plugin_loaders.get(tool, {}) or {}) > 0 for tool in TOOLS_CONFIG.keys()}
        return {
            "status": "healthy",
            "tools_initialized": tools_status
        }

    async def get_health_metrics(self) -> Dict[str, Any]:
        """Get current system health metrics (CPU, RAM, disk)."""
        loop = asyncio.get_running_loop()
        
        def _get_metrics():
            return {
                "cpu": psutil.cpu_percent(interval=1),
                "ram": psutil.virtual_memory().percent,
                "disk": psutil.disk_usage('/').percent
            }
        
        return await loop.run_in_executor(None, _get_metrics)

    async def get_storage_usage(self, case_id: Optional[int] = None) -> Dict[str, Any]:
        """Calculate storage breakdown for backups, reports, and system."""
        loop = asyncio.get_running_loop()
        
        # Get disk info
        disk = psutil.disk_usage('/')
        total = disk.total
        free = disk.free
        used = disk.used
        
        # Fetch paths from database
        if case_id:
            backup_rows = await db_fetch_all(
                "SELECT path FROM backups WHERE case_id = ?", (case_id,)
            )
            report_rows = await db_fetch_all(
                "SELECT path FROM reports WHERE case_id = ?", (case_id,)
            )
        else:
            backup_rows = await db_fetch_all("SELECT path FROM backups")
            report_rows = await db_fetch_all("SELECT path FROM reports")
        
        backup_paths = [row['path'] for row in backup_rows]
        report_paths = [row['path'] for row in report_rows]
        
        # Calculate sizes asynchronously
        backups_size = sum([
            await FileOperations.calc_directory_size(p) for p in backup_paths if os.path.exists(p)
        ])
        reports_size = sum([
            await FileOperations.calc_directory_size(p) for p in report_paths if os.path.exists(p)
        ])
        
        # System usage is everything else
        system_size = max(0, used - backups_size - reports_size)
        
        return {
            "total": total,
            "free": free,
            "breakdown": [
                {"name": "Backups", "value": backups_size, "color": "#3b82f6"},
                {"name": "Reports", "value": reports_size, "color": "#10b981"},
                {"name": "System", "value": system_size, "color": "#6b7280"},
                {"name": "Free", "value": free, "color": "#1f2937"}
            ]
        }

    async def get_recent_activity(self, case_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get recent backups and reports for dashboard activity feed."""
        if case_id:
            backups = await db_fetch_all(
                "SELECT id, name, 'backup' as type, status, created_at, path FROM backups WHERE case_id = ? ORDER BY created_at DESC LIMIT 5",
                (case_id,)
            )
            reports = await db_fetch_all(
                "SELECT id, name, 'report' as type, 'completed' as status, created_at, path FROM reports WHERE case_id = ? ORDER BY created_at DESC LIMIT 5",
                (case_id,)
            )
        else:
            backups = await db_fetch_all(
                "SELECT id, name, 'backup' as type, status, created_at, path FROM backups ORDER BY created_at DESC LIMIT 5"
            )
            reports = await db_fetch_all(
                "SELECT id, name, 'report' as type, 'completed' as status, created_at, path FROM reports ORDER BY created_at DESC LIMIT 5"
            )
        
        # Combine and sort
        activity = backups + reports
        activity.sort(key=lambda x: x['created_at'], reverse=True)
        
        return activity[:10]

    async def open_file_dialog(self) -> Dict[str, Any]:
        """Open native file dialog. Returns dict with file_path, success, message."""
        return await self._run_file_dialog(is_folder=False)

    async def open_folder_dialog(self) -> Dict[str, Any]:
        """Open native folder dialog. Returns dict with file_path, success, message."""
        return await self._run_file_dialog(is_folder=True)

    async def _run_file_dialog(self, is_folder: bool = False) -> Dict[str, Any]:
        """Internal helper to run native file/folder dialogs."""
        loop = asyncio.get_running_loop()
        
        def _execute_dialog():
            system = platform.system()
            dialog_type = "folder" if is_folder else "file"
            
            if system == "Darwin":
                if is_folder:
                    script = '''
                    tell application "System Events"
                        activate
                        set folderPath to choose folder with prompt "Select iLEAPP output folder"
                        return POSIX path of folderPath
                    end tell
                    '''
                else:
                    script = '''
                    tell application "System Events"
                        activate
                        set filePath to choose file with prompt "Select iLEAPP input file"
                        return POSIX path of filePath
                    end tell
                    '''
                cmd = ['osascript', '-e', script]
                
            elif system == "Linux":
                if not shutil.which("zenity"):
                    return {
                        "file_path": "",
                        "success": False,
                        "message": f"zenity is required for {dialog_type} dialogs on Linux."
                    }
                
                if is_folder:
                    cmd = ['zenity', '--file-selection', '--directory', '--title=Select iLEAPP output folder']
                else:
                    cmd = ['zenity', '--file-selection', '--title=Select iLEAPP input file']

            elif system == "Windows":
                # PowerShell commands to open native dialogs
                if is_folder:
                    ps_script = """
                    Add-Type -AssemblyName System.Windows.Forms
                    $f = New-Object System.Windows.Forms.FolderBrowserDialog
                    $f.Description = "Select iLEAPP output folder"
                    $f.ShowNewFolderButton = $true
                    if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                        Write-Output $f.SelectedPath
                    }
                    """
                else:
                    ps_script = """
                    Add-Type -AssemblyName System.Windows.Forms
                    $f = New-Object System.Windows.Forms.OpenFileDialog
                    $f.Title = "Select iLEAPP input file"
                    $f.Filter = "All Files (*.*)|*.*|Backup Files (*.zip;*.tar;*.tgz)|*.zip;*.tar;*.tgz"
                    if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                        Write-Output $f.FileName
                    }
                    """
                
                cmd = ['powershell', '-Command', ps_script]

            else:
                return {
                    "file_path": "",
                    "success": False,
                    "message": f"{dialog_type.capitalize()} browsing is not supported on {system}"
                }

            try:
                # On Windows, suppress the console window
                startupinfo = None
                if system == "Windows":
                    startupinfo = subprocess.STARTUPINFO()
                    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                    startupinfo.wShowWindow = subprocess.SW_HIDE

                result = subprocess.run(
                    cmd, 
                    capture_output=True, 
                    encoding='utf-8',
                    errors='replace', 
                    timeout=60,
                    startupinfo=startupinfo
                )
                
                if result.returncode == 0:
                    path = result.stdout.strip()
                    if path:
                        return {
                            "file_path": path,
                            "success": True,
                            "message": f"{dialog_type.capitalize()} selected successfully"
                        }
                    else:
                        return {
                            "file_path": "",
                            "success": False,
                            "message": f"User cancelled {dialog_type} selection"
                        }
                elif result.returncode == 1:
                    return {
                        "file_path": "",
                        "success": False,
                        "message": f"User cancelled {dialog_type} selection"
                    }
                else:
                    return {
                        "file_path": "",
                        "success": False,
                        "message": f"{dialog_type.capitalize()} dialog error: {result.stderr}"
                    }
                    
            except subprocess.TimeoutExpired:
                return {"file_path": "", "success": False, "message": f"{dialog_type.capitalize()} dialog timed out"}
            except Exception as e:
                return {"file_path": "", "success": False, "message": f"Failed to open {dialog_type} dialog: {str(e)}"}

        return await loop.run_in_executor(None, _execute_dialog)

    async def shutdown_backend(self) -> Dict[str, str]:
        """Gracefully shutdown the backend server."""
        import signal
        
        logger.info("Shutdown requested via SystemManager")
        
        # Schedule the kill signal to happen slightly after the response is sent
        loop = asyncio.get_running_loop()
        loop.call_later(0.1, os.kill, os.getpid(), signal.SIGINT)
        
        return {"message": "Shutting down..."}


# Global instance
system_manager = SystemManager()
