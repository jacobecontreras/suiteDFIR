from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse
import asyncio
import os
import logging
import shutil
import sqlite3
import subprocess
import platform
from datetime import datetime
from typing import List, Optional
from models import BackupRequest, ValidateBackupRequest
from database import DB_PATH
from state import backup_tasks, active_backups
from utils import broadcast_event, get_connected_devices, get_binary_path

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api",
    tags=["backups"]
)

# Backup Directory
# Adjust path since we are in backend/routers/
BACKUPS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backups", "libimobile")
os.makedirs(BACKUPS_DIR, exist_ok=True)

@router.get("/ios/devices")
async def list_devices():
    """List connected iOS devices"""
    return await get_connected_devices()

@router.post("/ios/validate-backup")
async def validate_backup(request: ValidateBackupRequest):
    """Check if an iOS backup is encrypted."""
    if not os.path.exists(request.input_path):
        raise HTTPException(status_code=400, detail="Input path does not exist")

    try:
        from utils import check_backup_encryption
        
        # Run the check in a thread pool to avoid blocking the event loop
        # since it does file I/O and imports
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, check_backup_encryption, request.input_path)
        
        if "error" in result:
             # Instead of failing, return unknown status so processing can proceed
             logger.warning(f"Validation error: {result['error']}")
             return {
                 "encrypted": False,
                 "type": "unknown",
                 "supported": False,
                 "message": f"Validation failed: {result['error']}"
             }
             
        return result
            
    except Exception as e:
        print(f"Validation exception: {e}")
        return {
             "encrypted": False,
             "type": "unknown",
             "supported": False,
             "message": f"Validation exception: {str(e)}"
        }

async def run_backup_process(backup_id: int, udid: str, backup_path: str, password: Optional[str] = None):
    # Cross-platform command resolution
    if platform.system() == "Windows":
        idevicebackup2_cmd = get_binary_path('idevicebackup2')
    else:
        # On macOS/Linux, rely on system-installed idevicebackup2
        idevicebackup2_cmd = 'idevicebackup2'
    
    cmd = [idevicebackup2_cmd, 'backup', backup_path, '-u', udid]
    
    conn = None
    process = None

    try:
        if password:
            # Enable encryption
            enc_cmd = [idevicebackup2_cmd, 'encryption', 'on', password, '-u', udid]
            enc_proc = await asyncio.create_subprocess_exec(
                *enc_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await enc_proc.communicate()
            if enc_proc.returncode != 0:
                # Failed to enable encryption
                error_msg = f"Failed to enable encryption: {stderr.decode()}"
                logger.error(error_msg)
                if backup_id in backup_tasks:
                    await backup_tasks[backup_id]["queue"].put(error_msg)
                    backup_tasks[backup_id]["status"] = "failed"
                
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                cursor.execute("UPDATE backups SET status = 'failed' WHERE id = ?", (backup_id,))
                conn.commit()
                conn.close()
                return

        # Create subprocess with increased stream limit to handle \r progress bars
        # idevicebackup2 uses \r for progress which can cause buffer overflow
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            limit=1024 * 1024  # 1MB limit instead of default 64KB
        )
        
        # Store process handle
        active_backups[backup_id] = process
        backup_tasks[backup_id]["process"] = process
        
        # Broadcast start
        await broadcast_event("backup_update", {"id": backup_id, "status": "in_progress"})

        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Stream output line by line
        # Use readline instead of async iteration to avoid buffer issues with \r progress bars
        while True:
            try:
                line = await asyncio.wait_for(process.stdout.readline(), timeout=60.0)
                if not line:
                    break
                
                line_text = line.decode().strip()
                if line_text:
                    # Filter out specific lines
                    if "*** Waiting for passcode to be entered on the device ***" in line_text:
                        continue

                    # Stream to queue
                    if backup_id in backup_tasks:
                        await backup_tasks[backup_id]["queue"].put(line_text)
                    
                    # Parse progress
                    if '%' in line_text:
                        try:
                            parts = line_text.split('%')[0].split()
                            if parts:
                                # Handle cases where output might be messy
                                # Usually "Processing: file (50%)" or just "50%"
                                # idevicebackup2 output varies
                                percentage = None
                                for part in parts:
                                    if part.endswith('%'):
                                        try:
                                            percentage = int(part[:-1])
                                            break
                                        except ValueError:
                                            continue
                                            
                                if percentage is not None:
                                    # Throttle DB updates - only update every 5% or if 100%
                                    # This prevents locking the DB during frequent updates
                                    if percentage % 5 == 0 or percentage == 100:
                                        cursor.execute(
                                            "UPDATE backups SET progress = ? WHERE id = ?",
                                            (percentage, backup_id)
                                        )
                                        conn.commit()
                        except Exception as e:
                            print(f"Error parsing progress: {e}")
            except asyncio.TimeoutError:
                # Check if process is still alive
                if process.returncode is not None:
                    break
                continue
            except Exception as e:
                print(f"Error reading backup output: {e}")
                break

        # Wait for process to finish
        await process.wait()
        
        # Final status update
        status = 'failed' # Default to failed
        
        if process.returncode == 0:
            status = 'completed'
            if backup_id in backup_tasks:
                await backup_tasks[backup_id]["queue"].put("Backup completed successfully")
            await broadcast_event("backup_update", {"id": backup_id, "status": "completed"})
        else:
            # Check if it was cancelled
            cursor.execute("SELECT status FROM backups WHERE id = ?", (backup_id,))
            row = cursor.fetchone()
            current_status = row[0] if row else 'failed'
            
            if current_status == 'cancelled':
                status = 'cancelled'
                if backup_id in backup_tasks:
                    await backup_tasks[backup_id]["queue"].put("Backup cancelled by user")
            else:
                status = 'failed'
                if backup_id in backup_tasks:
                    await backup_tasks[backup_id]["queue"].put(f"Backup failed with exit code {process.returncode}")
        
        if backup_id in backup_tasks:
            backup_tasks[backup_id]["status"] = status
        
        # Update DB with final status
        if status == 'completed':
            cursor.execute("UPDATE backups SET status = ?, progress = 100 WHERE id = ?", (status, backup_id))
            conn.commit()
            
            # Calculate size if successful
            try:
                total_size = 0
                for dirpath, dirnames, filenames in os.walk(backup_path):
                    for f in filenames:
                        fp = os.path.join(dirpath, f)
                        if not os.path.islink(fp):
                            total_size += os.path.getsize(fp)
                
                size_str = f"{total_size / (1024*1024*1024):.2f} GB"
                cursor.execute("UPDATE backups SET size = ? WHERE id = ?", (size_str, backup_id))
                conn.commit()
            except Exception as e:
                print(f"Error calculating size: {e}")
        else:
            # Cleanup failed or cancelled backup
            print(f"DEBUG: Backup {status}. Cleaning up...")
            
            # Delete from DB
            cursor.execute("DELETE FROM backups WHERE id = ?", (backup_id,))
            conn.commit()
            print(f"DEBUG: Deleted backup record {backup_id} from DB")
            
            # Delete from filesystem
            if os.path.exists(backup_path):
                try:
                    # Run blocking I/O in thread pool
                    loop = asyncio.get_running_loop()
                    await loop.run_in_executor(None, shutil.rmtree, backup_path)
                    print(f"DEBUG: Deleted backup directory {backup_path}")
                except Exception as e:
                    print(f"Error deleting backup files: {e}")

    except Exception as e:
        logger.error(f"Backup error: {e}")
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("UPDATE backups SET status = 'failed' WHERE id = ?", (backup_id,))
            conn.commit()
            conn.close()
        except Exception as db_e:
            logger.error(f"Failed to update DB after backup error: {db_e}")
            
        if backup_id in backup_tasks:
            await backup_tasks[backup_id]["queue"].put(f"Backup error: {str(e)}")
            backup_tasks[backup_id]["status"] = "failed"
            
    finally:
        if conn and hasattr(conn, 'close'):
            try:
                conn.close()
            except:
                pass
        if backup_id in active_backups:
            del active_backups[backup_id]
        # Note: We don't delete from backup_tasks here to allow the stream to finish sending logs

@router.post("/ios/backup")
async def start_backup(request: BackupRequest, background_tasks: BackgroundTasks):
    """Start iOS backup"""
    # Check if device is still connected
    devices = await get_connected_devices()
    device = next((d for d in devices if d['udid'] == request.udid), None)
    
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
        
    # Create backup directory
    backup_path = os.path.join(BACKUPS_DIR, f"{request.name}_{request.udid}_{int(datetime.now().timestamp())}")
    os.makedirs(backup_path, exist_ok=True)
    
    # Create DB entry
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO backups (name, device_udid, device_name, path, status, password, case_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (request.name, request.udid, device['name'], backup_path, 'in_progress', request.password, request.case_id)
    )
    backup_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    # Initialize task queue BEFORE starting async task
    # This prevents race condition where frontend connects to stream before task exists
    backup_tasks[backup_id] = {
        "queue": asyncio.Queue(),
        "status": "in_progress",
        "process": None
    }
    
    background_tasks.add_task(run_backup_process, backup_id, request.udid, backup_path, request.password)
    
    # This async function is just a placeholder to return the response quickly
    async def run_backup_placeholder():
        # Wait a bit for response to be sent
        await asyncio.sleep(0.1)
        # Actual process is started in background_tasks.add_task
        pass
        
    asyncio.create_task(run_backup_placeholder())
    
    return {"message": "Backup started", "backup_id": backup_id}

@router.get("/ios/backup/stream/{backup_id}")
async def stream_backup_logs(backup_id: int):
    """SSE endpoint for real-time backup logs."""
    if backup_id not in backup_tasks:
        raise HTTPException(status_code=404, detail="Backup task not found")

    async def event_generator():
        # Check if task still exists at start
        if backup_id not in backup_tasks:
            return
            
        queue = backup_tasks[backup_id]["queue"]
        
        while True:
            # Check if task still exists and get status
            if backup_id not in backup_tasks:
                break
                
            # Check status
            if backup_tasks[backup_id]["status"] in ["completed", "failed", "cancelled"] and queue.empty():
                break
                
            try:
                # Wait for message with timeout to check status periodically
                message = await asyncio.wait_for(queue.get(), timeout=1.0)
                yield f"data: {message}\n\n"
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                yield f"data: Error reading log: {str(e)}\n\n"
                break

        # Send final status if task still exists
        if backup_id in backup_tasks:
            final_status = backup_tasks[backup_id]["status"]
            yield f"data: Backup {final_status}\n\n"
            yield f"event: close\ndata: Stream ended\n\n"
            
            # Give client time to process close event
            await asyncio.sleep(0.5)
            
            # Cleanup
            del backup_tasks[backup_id]

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )

@router.post("/ios/backup/{backup_id}/stop")
async def stop_backup(backup_id: int):
    """Stop an active backup"""
    
    # Update status IMMEDIATELY to give feedback
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("UPDATE backups SET status = 'cancelled' WHERE id = ?", (backup_id,))
    conn.commit()
    conn.close()
    
    if backup_id in backup_tasks:
        backup_tasks[backup_id]["status"] = "cancelled"
        await backup_tasks[backup_id]["queue"].put("Stopping backup...")

    if backup_id in active_backups and active_backups[backup_id] is not None:
        process = active_backups[backup_id]
        try:
            # Send SIGTERM
            process.terminate()
            
            # We don't wait here, run_backup_process will handle the exit
            
        except Exception as e:
            print(f"Error stopping backup process: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to stop backup: {str(e)}")
            
    return {"message": "Backup stop requested"}

@router.get("/backups")
async def get_backups(case_id: Optional[int] = None):
    """Get list of backups"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    if case_id:
        cursor.execute("SELECT id, name, device_udid, device_name, path, created_at, status, size, progress, type FROM backups WHERE case_id = ? ORDER BY created_at DESC", (case_id,))
    else:
        cursor.execute("SELECT id, name, device_udid, device_name, path, created_at, status, size, progress, type FROM backups ORDER BY created_at DESC")
    
    backups = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return backups

@router.delete("/backups/{backup_id}")
async def delete_backup(backup_id: int):
    """Delete backup"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get path
    cursor.execute("SELECT path FROM backups WHERE id = ?", (backup_id,))
    row = cursor.fetchone()
    
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Backup not found")
        
    path = row[0]
    
    # Delete from DB
    cursor.execute("DELETE FROM backups WHERE id = ?", (backup_id,))
    conn.commit()
    conn.close()
    
    # Delete from filesystem
    if os.path.exists(path):
        try:
            # Run blocking I/O in thread pool
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, shutil.rmtree, path)
        except Exception as e:
            print(f"Error deleting backup files: {e}")
            
    return {"message": "Backup deleted"}

@router.post("/ios/backup/open")
async def open_backup_location(path: str):
    """Open backup folder in system file explorer"""
    # Security check: ensure path is within BACKUPS_DIR
    if not os.path.abspath(path).startswith(os.path.abspath(BACKUPS_DIR)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Backup not found")

    try:
        if platform.system() == "Darwin":  # macOS
            subprocess.run(["open", path])
        elif platform.system() == "Windows":
            os.startfile(path)
        else:  # Linux
            subprocess.run(["xdg-open", path])
        return {"message": "Backup opened successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open backup: {str(e)}")

@router.get("/ios/backup/download")
async def download_backup(path: str):
    """Zip and download backup directory"""
    # Security check: ensure path is within BACKUPS_DIR
    if not os.path.abspath(path).startswith(os.path.abspath(BACKUPS_DIR)):
        raise HTTPException(status_code=403, detail="Access denied")

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Backup not found")

    try:
        # Create zip in temp location
        import tempfile
        temp_dir = tempfile.mkdtemp()
        zip_name = f"{os.path.basename(path)}.zip"
        zip_path = os.path.join(temp_dir, zip_name)
        
        # Run zipping in thread pool as it can be slow
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None, 
            lambda: shutil.make_archive(os.path.splitext(zip_path)[0], 'zip', path)
        )
        
        return FileResponse(
            zip_path,
            media_type='application/zip',
            filename=zip_name
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to download backup: {str(e)}")
