from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
import platform
import shutil
import subprocess
import psutil
import sys
import os
import json
import asyncio
import sqlite3
import csv
import io
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

from models import FilePathResponse
from database import DB_PATH
from utils import get_size_format, normalize_report_path, get_operating_system
from config import TOOLS_CONFIG, REPORTS_DIR
from state import plugin_loaders, available_modules, event_clients


router = APIRouter()

@router.get("/")
async def root():
    total_modules = sum(len(modules) for modules in available_modules.values())
    return {
        "message": "Forensic Tools Web API is running",
        "tools": list(TOOLS_CONFIG.keys()),
        "modules_loaded": total_modules
    }

@router.get("/health")
async def health_check():
    tools_status = {tool: len(plugin_loaders.get(tool, {}) or {}) > 0 for tool in TOOLS_CONFIG.keys()}
    return {
        "status": "healthy",
        "tools_initialized": tools_status
    }

@router.post("/api/browse-files", response_model=FilePathResponse)
async def browse_files():
    """
    Open native file dialog to select forensic files.
    Supports macOS (osascript), Windows (PowerShell), and Linux (zenity).
    Returns the absolute path of the selected file.
    """
    try:
        system = platform.system()
        
        if system == "Darwin":
            # Minimal osascript for macOS file dialog (no type restrictions)
            script = '''
            tell application "System Events"
                activate
                set filePath to choose file with prompt "Select iLEAPP input file"
                return POSIX path of filePath
            end tell
            '''
            cmd = ['osascript', '-e', script]
            
        elif system == "Windows":
            # PowerShell file dialog for Windows
            script = '''
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Select iLEAPP input file"
$dialog.Filter = "All Files (*.*)|*.*|ZIP Files (*.zip)|*.zip|TAR Files (*.tar)|*.tar"
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
}
'''
            cmd = ['powershell', '-NoProfile', '-Command', script]
            
        elif system == "Linux":
            # Check for zenity
            if not shutil.which("zenity"):
                return FilePathResponse(
                    file_path="", 
                    success=False, 
                    message="zenity is required for file dialogs on Linux. Please install it (e.g., sudo apt install zenity)."
                )
            
            # Zenity command for file selection
            cmd = ['zenity', '--file-selection', '--title=Select iLEAPP input file']
            
        else:
            raise HTTPException(
                status_code=400,
                detail=f"File browsing is not supported on {system}"
            )

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            file_path = result.stdout.strip()
            return FilePathResponse(
                file_path=file_path,
                success=True,
                message="File selected successfully"
            )

        # Handle all error cases
        if result.returncode == 1:
            return FilePathResponse(file_path="", success=False, message="User cancelled file selection")
            
        return FilePathResponse(file_path="", success=False, message=f"File dialog error: {result.stderr}")

    except subprocess.TimeoutExpired:
        return FilePathResponse(file_path="", success=False, message="File dialog timed out")
    except Exception as e:
        return FilePathResponse(file_path="", success=False, message=f"Failed to open file dialog: {str(e)}")

@router.post("/api/browse-folders", response_model=FilePathResponse)
async def browse_folders():
    """
    Open native folder dialog to select output directory.
    Supports macOS (osascript), Windows (PowerShell), and Linux (zenity).
    Returns the absolute path of the selected folder.
    """
    try:
        system = platform.system()
        
        if system == "Darwin":
            # Minimal osascript for macOS folder dialog
            script = '''
            tell application "System Events"
                activate
                set folderPath to choose folder with prompt "Select iLEAPP output folder"
                return POSIX path of folderPath
            end tell
            '''
            cmd = ['osascript', '-e', script]
            
        elif system == "Windows":
            # PowerShell folder dialog for Windows
            script = '''
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select iLEAPP output folder"
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.SelectedPath
}
'''
            cmd = ['powershell', '-NoProfile', '-Command', script]
            
        elif system == "Linux":
            # Check for zenity
            if not shutil.which("zenity"):
                return FilePathResponse(
                    file_path="", 
                    success=False, 
                    message="zenity is required for folder dialogs on Linux. Please install it (e.g., sudo apt install zenity)."
                )
            
            # Zenity command for folder selection
            cmd = ['zenity', '--file-selection', '--directory', '--title=Select iLEAPP output folder']
            
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Folder browsing is not supported on {system}"
            )

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            folder_path = result.stdout.strip()
            return FilePathResponse(
                file_path=folder_path,
                success=True,
                message="Folder selected successfully"
            )

        # Handle all error cases
        if result.returncode == 1:
            return FilePathResponse(file_path="", success=False, message="User cancelled folder selection")
            
        return FilePathResponse(file_path="", success=False, message=f"Folder dialog error: {result.stderr}")

    except subprocess.TimeoutExpired:
        return FilePathResponse(file_path="", success=False, message="Folder dialog timed out")
    except Exception as e:
        return FilePathResponse(file_path="", success=False, message=f"Failed to open folder dialog: {str(e)}")

def get_disk_usage():
    """Get disk usage in a cross-platform way."""
    if sys.platform == 'win32':
        # Use the current working directory's drive on Windows
        root_path = os.path.abspath(os.sep)
    else:
        root_path = '/'
    return shutil.disk_usage(root_path)

@router.get("/api/system/health")
async def get_system_health():
    disk = get_disk_usage()
    return {
        "cpu": psutil.cpu_percent(interval=1),
        "ram": psutil.virtual_memory().percent,
        "disk": (disk.used / disk.total) * 100
    }

@router.get("/api/system/os")
async def get_os_info():
    """Return operating system information"""
    return get_operating_system()

@router.get("/api/system/storage")
async def get_storage_usage(case_id: Optional[int] = None):
    # Get total disk usage using cross-platform shutil.disk_usage
    disk = get_disk_usage()
    total = disk.total
    free = disk.free
    used = disk.used
    
    # Calculate size of backups and reports
    backups_size = 0
    reports_size = 0
    
    # Helper to get directory size
    def get_dir_size(path):
        total_size = 0
        for dirpath, dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    total_size += os.path.getsize(fp)
        return total_size

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    if case_id:
        cursor.execute("SELECT path FROM backups WHERE case_id = ?", (case_id,))
    else:
        cursor.execute("SELECT path FROM backups")
    backup_paths = [row[0] for row in cursor.fetchall()]
    
    if case_id:
        cursor.execute("SELECT path FROM reports WHERE case_id = ?", (case_id,))
    else:
        cursor.execute("SELECT path FROM reports")
    report_paths = [row[0] for row in cursor.fetchall()]
    
    conn.close()
    
    for path in backup_paths:
        if os.path.exists(path):
            if os.path.isfile(path):
                backups_size += os.path.getsize(path)
            else:
                backups_size += get_dir_size(path)
                
    for path in report_paths:
        if os.path.exists(path):
             if os.path.isfile(path):
                reports_size += os.path.getsize(path)
             else:
                reports_size += get_dir_size(path)

    # System usage is everything else used
    system_size = max(0, used - backups_size - reports_size)
    
    return {
        "total": total,
        "free": free,
        "breakdown": [
            {"name": "Backups", "value": backups_size, "color": "#3b82f6"}, # Blue
            {"name": "Reports", "value": reports_size, "color": "#10b981"}, # Green
            {"name": "System", "value": system_size, "color": "#6b7280"},  # Gray
            {"name": "Free", "value": free, "color": "#1f2937"}    # Dark Gray
        ]
    }

@router.get("/api/dashboard/activity")
async def get_recent_activity(case_id: Optional[int] = None):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get recent backups
    if case_id:
        cursor.execute("SELECT id, name, 'backup' as type, status, created_at, path FROM backups WHERE case_id = ? ORDER BY created_at DESC LIMIT 5", (case_id,))
    else:
        cursor.execute("SELECT id, name, 'backup' as type, status, created_at, path FROM backups ORDER BY created_at DESC LIMIT 5")
    backups = [dict(row) for row in cursor.fetchall()]
    
    # Get recent reports
    if case_id:
        cursor.execute("SELECT id, name, 'report' as type, 'completed' as status, created_at, path FROM reports WHERE case_id = ? ORDER BY created_at DESC LIMIT 5", (case_id,))
    else:
        cursor.execute("SELECT id, name, 'report' as type, 'completed' as status, created_at, path FROM reports ORDER BY created_at DESC LIMIT 5")
    reports = [dict(row) for row in cursor.fetchall()]
    # Normalize report paths
    for r in reports:
        r['path'] = normalize_report_path(r['path'])
    
    conn.close()
    
    # Combine and sort
    activity = backups + reports
    activity.sort(key=lambda x: x['created_at'], reverse=True)
    
    return activity[:10] # Return top 10


@router.get("/api/stream")
async def stream_events():
    """Unified SSE endpoint for real-time updates"""
    async def event_generator():
        queue = asyncio.Queue()
        event_clients.add(queue)
        
        try:
            
            while True:
                # Wait for updates
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            event_clients.remove(queue)
            
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )

@router.get("/api/spatial/kml-files")
async def get_kml_files(case_id: Optional[int] = None):
    """Scan reports directory for KML files, optionally filtered by case_id."""
    kml_files = {}
    
    try:
        # Fetch report names and paths from DB to map paths to user-defined names
        # If case_id is provided, only fetch reports for that case
        report_map = {} # path -> name
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            
            if case_id:
                cursor.execute("SELECT path, name FROM reports WHERE case_id = ?", (case_id,))
            else:
                cursor.execute("SELECT path, name FROM reports")
                
            for path, name in cursor.fetchall():
                # Normalize path to ensure matching works
                report_map[os.path.normpath(path)] = name
            conn.close()
        except Exception as e:
            print(f"Error fetching report names from DB: {e}")

        # Walk through the reports directory
        for root, dirs, files in os.walk(REPORTS_DIR):
            if "_KML Exports" in root:
                # Extract report name from path
                # Path structure: .../reports/tool-reports/Report_Name/_KML Exports
                parts = Path(root).parts
                try:
                    kml_index = parts.index("_KML Exports")
                    folder_name = parts[kml_index - 1]
                    
                    # Find tool name (parent of report name)
                    tool_name = parts[kml_index - 2].replace("-reports", "")
                    
                    # Get the absolute path to the report directory (parent of _KML Exports)
                    report_dir = os.path.dirname(root)
                    norm_report_dir = os.path.normpath(report_dir)
                    
                    # Filter: If case_id was provided, only include reports that are in our filtered map
                    if case_id and norm_report_dir not in report_map:
                        continue
                        
                    # Look up user-defined name from DB, fallback to folder name
                    display_name = report_map.get(norm_report_dir, folder_name)
                    group_name = display_name
                    
                    if group_name not in kml_files:
                        kml_files[group_name] = []
                        
                    for file in files:
                        if file.lower().endswith('.kml') or file.lower().endswith('.kmz'):
                            # Construct accessible URL
                            # We need to map the file system path to the static mount path
                            # File path: .../reports/tool-reports/Report_Name/_KML Exports/file.kml
                            # URL: /tool-reports/Report_Name/_KML Exports/file.kml
                            
                            relative_path = os.path.relpath(os.path.join(root, file), REPORTS_DIR)
                            url = f"/reports/{relative_path}"
                            
                            kml_files[group_name].append({
                                "name": file,
                                "url": url,
                                "path": os.path.join(root, file)
                            })
                except ValueError:
                    continue
                    
        return kml_files
    except Exception as e:
        print(f"Error scanning KML files: {e}")
        return {}

@router.get("/api/spatial/kml-data")
async def get_kml_data(path: str):
    """
    Fetch and enrich KML data with TSV content.
    path: Relative path to the KML file (e.g., /reports/ileapp-reports/.../file.kml)
    """
    try:
        # Clean up path (remove leading /reports/)
        clean_path = path.replace("/reports/", "", 1)
        kml_abs_path = os.path.join(REPORTS_DIR, clean_path)
        
        if not os.path.exists(kml_abs_path):
            raise HTTPException(status_code=404, detail="KML file not found")

        # Determine TSV path
        # Strategy 1: Replace '_KML Exports' with '_TSV Exports'
        tsv_dir = os.path.dirname(kml_abs_path).replace("_KML Exports", "_TSV Exports")
        kml_filename = os.path.basename(kml_abs_path)
        
        # Strategy 2: Exact match (.kml -> .tsv)
        tsv_filename = kml_filename.replace(".kml", ".tsv")
        tsv_abs_path = os.path.join(tsv_dir, tsv_filename)
        
        # Strategy 3: Remove " Location Data" suffix if exact match fails
        if not os.path.exists(tsv_abs_path):
            tsv_filename_alt = kml_filename.replace(" Location Data.kml", ".tsv")
            tsv_abs_path_alt = os.path.join(tsv_dir, tsv_filename_alt)
            if os.path.exists(tsv_abs_path_alt):
                tsv_abs_path = tsv_abs_path_alt

        # Parse TSV Data
        tsv_data = {}
        timestamp_col = None
        POSSIBLE_KEYS = ['Timestamp', 'Update Time', 'Date', 'Time', 'Created Time', 'Modified Time', 'DateTime']

        if os.path.exists(tsv_abs_path):
            try:
                # Use utf-8-sig to handle BOM if present
                with open(tsv_abs_path, 'r', encoding='utf-8-sig', errors='replace') as f:
                    reader = csv.DictReader(f, delimiter='\t')
                    
                    # Determine timestamp column from header
                    if reader.fieldnames:
                        for key in POSSIBLE_KEYS:
                            if key in reader.fieldnames:
                                timestamp_col = key
                                break
                    
                    if timestamp_col:
                        for row in reader:
                            if timestamp_col in row:
                                tsv_data[row[timestamp_col]] = row
                    else:
                        print(f"Warning: No timestamp column found in {tsv_filename}. Keys: {reader.fieldnames}")

            except Exception as e:
                print(f"Error reading TSV file: {e}")

        # Parse and Enrich KML
        try:
            # Register namespace to avoid ns0: prefixes
            ET.register_namespace('', "http://www.opengis.net/kml/2.2")
            tree = ET.parse(kml_abs_path)
            root = tree.getroot()
            
            # XML Namespaces
            ns = {'kml': 'http://www.opengis.net/kml/2.2'}
            
            # Find all Placemarks
            placemarks = root.findall('.//kml:Placemark', ns)
            
            for placemark in placemarks:
                name_elem = placemark.find('kml:name', ns)
                desc_elem = placemark.find('kml:description', ns)
                
                if name_elem is not None:
                    if name_elem.text in tsv_data:
                        row = tsv_data[name_elem.text]
                        
                        # Build HTML Table
                        html_table = '<table class="table table-striped table-bordered table-hover table-sm">'
                        
                        # Add Artifact Name row (derived from filename or fixed string)
                        artifact_name = tsv_filename.replace(".tsv", "")
                        html_table += f'<tr><td colspan="2"><strong>Artifact</strong></td><td>{artifact_name}</td></tr>'
                        
                        for key, value in row.items():
                            if key and value:
                                html_table += f'<tr><td colspan="2"><strong>{key}</strong></td><td>{value}</td></tr>'
                        html_table += '</table>'
                        
                        # Update description
                        if desc_elem is None:
                            desc_elem = ET.SubElement(placemark, 'description')
                        desc_elem.text = html_table

            # Return enriched KML
            output = io.BytesIO()
            tree.write(output, encoding='utf-8', xml_declaration=True)
            output.seek(0)
            return StreamingResponse(output, media_type="application/vnd.google-earth.kml+xml")

        except Exception as e:
            print(f"Error parsing KML: {e}")
            # Fallback: return original file if parsing fails
            return FileResponse(kml_abs_path)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/shutdown")
async def shutdown():
    """Gracefully shutdown the backend server"""
    import signal
    import os

    # Log shutdown
    print("Shutdown requested via API")

    # Send SIGINT to trigger graceful shutdown
    os.kill(os.getpid(), signal.SIGINT)

    return {"message": "Shutting down..."}
