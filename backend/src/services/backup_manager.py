
import asyncio
import os
import pty
import subprocess
import logging
import shutil
import time
from typing import Optional, List, Dict, Any

from core.config import BACKUPS_DIR
from core.database import db_execute, db_fetch_one, db_fetch_all, db_execute_return_id
from core.state import active_backups, backup_tasks
from utils.helpers import broadcast_event, get_connected_devices, get_binary_path, check_backup_encryption

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

class BackupManager:
    """Manages iOS backup processes and their state."""

    def __init__(self):
        os.makedirs(BACKUPS_DIR, exist_ok=True)

    async def get_devices(self) -> List[Dict[str, Any]]:
        """List connected iOS and Android devices."""
        from utils.helpers import get_connected_android_devices
        ios_devices = await get_connected_devices()
        android_devices = await get_connected_android_devices()
        return ios_devices + android_devices

    async def get_backups(self, case_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get list of backups for a specific case."""
        if not case_id:
            return []
        return await db_fetch_all(
            "SELECT id, name, device_udid, device_name, path, created_at, status, size, progress, type, case_id FROM backups WHERE case_id = ? ORDER BY created_at DESC",
            (case_id,)
        )

    async def delete_backup_by_id(self, backup_id: int) -> Dict[str, Any]:
        """Delete a backup by ID from DB and filesystem."""
        row = await db_fetch_one("SELECT path FROM backups WHERE id = ?", (backup_id,))
        
        if not row:
            raise ValueError("Backup record not found")
        
        path = row['path']
        
        # Delete from DB
        await db_execute("DELETE FROM backups WHERE id = ?", (backup_id,))
        
        # Delete from filesystem
        await self.cleanup_backup_files(path)
        
        return {"success": True, "message": "Backup deleted"}

    async def start_backup(self, request: Any, background_tasks: Any) -> Dict[str, Any]:
        """Start an iOS backup process."""
        # Check if device is still connected
        devices = await self.get_devices()
        device = next((d for d in devices if d['udid'] == request.udid), None)
        
        if not device:
            raise ValueError("Device not found or not connected")
            
        # Create backup directory
        backup_path = os.path.join(BACKUPS_DIR, f"{request.name}_{request.udid}_{int(time.time())}")
        os.makedirs(backup_path, exist_ok=True)
        
        # Create DB entry
        device_type = device.get('type', 'ios')
        backup_id = await db_execute_return_id(
            "INSERT INTO backups (name, device_udid, device_name, path, status, password, case_id, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (request.name, request.udid, device['name'], backup_path, 'in_progress', request.password, request.case_id, device_type)
        )

        # Initialize task queue for SSE streaming (maxsize prevents unbounded memory growth)
        backup_tasks[backup_id] = {
            "queue": asyncio.Queue(maxsize=1000),
            "status": "in_progress",
            "process": None
        }

        # Start background task depending on type
        if device_type == 'android':
            is_rooted = device.get('is_rooted', False)
            background_tasks.add_task(self._run_android_backup_loop, backup_id, request.udid, backup_path, is_rooted)
        else:
            background_tasks.add_task(self._run_backup_loop, backup_id, request.udid, backup_path, request.password)

        return {"success": True, "backup_id": backup_id, "message": "Backup started"}

    async def stop_backup(self, backup_id: int) -> Dict[str, Any]:
        """Stop an active backup process."""
        # Delete row immediately to give feedback and clean up database
        await db_execute("DELETE FROM backups WHERE id = ?", (backup_id,))

        if backup_id in active_backups and active_backups[backup_id] is not None:
            process = active_backups[backup_id]
            try:
                process.terminate()
                return {"success": True, "message": "Backup stop requested"}
            except Exception as e:
                logger.error(f"Error stopping backup process {backup_id}: {e}")
                raise RuntimeError(f"Failed to stop backup process: {e}")

        return {"success": True, "message": "Backup not active or already stopped"}

    async def _run_backup_loop(self, backup_id: int, udid: str, backup_path: str, password: Optional[str] = None):
        """Internal loop to handle the backup subprocess and log streaming."""
        try:
            # Setup Encryption if needed
            if password:
                success = await self._setup_encryption(backup_id, udid, password, backup_path)
                if not success:
                    return

            # Start Subprocess
            idevice_backup_cmd = get_binary_path("idevicebackup2")
            cmd = [idevice_backup_cmd, 'backup', backup_path, '-u', udid]

            # Broadcast start
            await broadcast_event("backup_update", {"id": backup_id, "status": "in_progress"})

            # Use a PTY for idevicebackup2 as well so prompt/progress lines flush
            # with terminal-style behavior instead of pipe buffering.
            return_code = await self._run_pty_command(backup_id, cmd, backup_path)
            
            # Finalize Status and DB
            await self._finalize_backup(backup_id, return_code, backup_path)

        except Exception as e:
            logger.error(f"Backup error for {backup_id}: {e}", exc_info=True)
            await self._handle_loop_error(backup_id, e)
                
        finally:
            if backup_id in active_backups:
                del active_backups[backup_id]

    async def _run_android_backup_loop(self, backup_id: int, udid: str, backup_path: str, is_rooted: bool):
        """Internal loop to handle an Android logical extraction via ADB.
        Uses a PTY so that ADB emits per-file progress (it suppresses output when not on a TTY).
        """
        try:
            await broadcast_event("backup_update", {"id": backup_id, "status": "in_progress"})
            
            adb_cmd = get_binary_path("adb")
            
            # Create subdirectories for organized pulls
            sdcard_path = os.path.join(backup_path, "sdcard")
            os.makedirs(sdcard_path, exist_ok=True)
            
            data_path = os.path.join(backup_path, "data")
            if is_rooted:
                os.makedirs(data_path, exist_ok=True)

            if backup_id in backup_tasks:
                import json
                await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": "Starting Android logical extraction..."}))
                if is_rooted:
                    await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": "Device is rooted. Will attempt full /data/data/ pull."}))

            return_code = 0

            # 1. Pull /sdcard/ (Always available) -- use PTY for real-time output
            sdcard_cmd = [adb_cmd, '-s', udid, 'pull', '/sdcard/', sdcard_path]
            sdcard_ret = await self._run_pty_command(backup_id, sdcard_cmd, backup_path)
            if sdcard_ret != 0:
                return_code = sdcard_ret

            # 2. Pull /data/data/ (If Rooted)
            if is_rooted:
                if backup_id in backup_tasks:
                    import json
                    await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": "Starting /data/data/ pull..."}))
                
                # Try `adb root` first to restart adbd as root
                root_restart_cmd = [adb_cmd, '-s', udid, 'root']
                root_proc = await asyncio.create_subprocess_exec(*root_restart_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                await root_proc.communicate()
                await asyncio.sleep(2)
                
                # Now try direct pull via PTY
                data_pull_cmd = [adb_cmd, '-s', udid, 'pull', '/data/data/', data_path]
                data_ret = await self._run_pty_command(backup_id, data_pull_cmd, backup_path)
                
                if data_ret != 0:
                    if backup_id in backup_tasks:
                        import json
                        await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": "Warning: Direct /data/data/ pull failed. Root access might be restricted by adbd."}))
            
            # Finalize Status and DB
            await self._finalize_backup(backup_id, return_code, backup_path)

        except Exception as e:
            logger.error(f"Android backup error for {backup_id}: {e}", exc_info=True)
            await self._handle_loop_error(backup_id, e)
                
        finally:
            if backup_id in active_backups:
                del active_backups[backup_id]

    async def _run_pty_command(self, backup_id: int, cmd: list, backup_path: str) -> int:
        """Run a command inside a PTY so it thinks it has a real terminal.
        Returns the process exit code.
        """
        master_fd, slave_fd = pty.openpty()
        try:
            process = subprocess.Popen(
                cmd,
                stdout=slave_fd,
                stderr=slave_fd,
                stdin=subprocess.DEVNULL,
                close_fds=True
            )
            os.close(slave_fd)  # Parent doesn't need the slave end
            slave_fd = -1

            active_backups[backup_id] = process

            # Stream the PTY output asynchronously
            await self._stream_pty_output(backup_id, master_fd, backup_path)

            # Wait for process to finish
            process.wait()
            return process.returncode
        finally:
            if slave_fd != -1:
                os.close(slave_fd)
            try:
                os.close(master_fd)
            except OSError:
                pass

    async def _stream_pty_output(self, backup_id: int, master_fd: int, backup_path: str):
        """Read from the PTY master fd and process each line."""
        import json
        loop = asyncio.get_running_loop()
        buffer = bytearray()

        while True:
            try:
                # Read from the PTY fd in an executor to avoid blocking the event loop
                chunk = await asyncio.wait_for(
                    loop.run_in_executor(None, lambda: os.read(master_fd, 4096)),
                    timeout=120.0
                )

                if not chunk:
                    # EOF
                    if buffer:
                        await self._process_log_line(backup_id, buffer.decode('utf-8', errors='replace').strip(), backup_path)
                    break

                for byte_val in chunk:
                    if byte_val == 13 or byte_val == 10:  # \r or \n
                        if buffer:
                            line_text = buffer.decode('utf-8', errors='replace').strip()
                            buffer.clear()
                            await self._process_log_line(backup_id, line_text, backup_path)
                    else:
                        buffer.append(byte_val)

            except asyncio.TimeoutError:
                # Check if process is still alive
                proc = active_backups.get(backup_id)
                if proc and hasattr(proc, 'poll') and proc.poll() is not None:
                    break
                continue
            except OSError:
                # PTY closed (process exited)
                if buffer:
                    await self._process_log_line(backup_id, buffer.decode('utf-8', errors='replace').strip(), backup_path)
                break
            except Exception as e:
                logger.error(f"Error reading PTY output for {backup_id}: {e}")
                if backup_id in backup_tasks:
                    await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": f"Error reading log: {str(e)}"}))
                break

    async def _setup_encryption(self, backup_id: int, udid: str, password: str, backup_path: str) -> bool:
        """Enable encryption on the device before backup."""
        idevice_backup_cmd = get_binary_path("idevicebackup2")
        enc_cmd = [idevice_backup_cmd, 'encryption', 'on', password, '-u', udid]

        enc_proc = await asyncio.create_subprocess_exec(
            *enc_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await enc_proc.communicate()

        if enc_proc.returncode != 0:
            error_msg = f"Failed to enable encryption: {stderr.decode('utf-8', errors='replace')}"
            logger.error(error_msg)

            # Update database status
            await db_execute("UPDATE backups SET status = 'failed' WHERE id = ?", (backup_id,))

            # Broadcast failure event
            await broadcast_event("backup_update", {"id": backup_id, "status": "failed"})
            
            if backup_id in backup_tasks:
                import json
                await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": error_msg}))
                backup_tasks[backup_id]["status"] = "failed"

            # Clean up files
            await self.cleanup_backup_files(backup_path)

            return False
        return True

    async def _stream_output(self, backup_id: int, process: asyncio.subprocess.Process, backup_path: str):
        """Read and log subprocess output."""
        import json
        buffer = bytearray()
        while True:
            try:
                # Read byte by byte to ensure immediate flushing for \r lines
                chunk = await asyncio.wait_for(process.stdout.read(1), timeout=60.0)
                
                if not chunk:
                    logger.debug(f"Backup {backup_id} stdout EOF")
                    if buffer:
                        await self._process_log_line(backup_id, buffer.decode('utf-8', errors='replace').strip(), backup_path)
                    break

                for byte in chunk:
                    if byte == 13 or byte == 10:  # \r or \n
                        if buffer:
                            line_text = buffer.decode('utf-8', errors='replace').strip()
                            buffer.clear()
                            await self._process_log_line(backup_id, line_text, backup_path)
                    else:
                        buffer.append(byte)

            except asyncio.TimeoutError:
                if process.returncode is not None:
                    break
                continue
            except Exception as e:
                logger.error(f"Error reading backup output for {backup_id}: {e}")
                if backup_id in backup_tasks:
                    await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": f"Error reading log: {str(e)}"}))
                break

    async def _process_log_line(self, backup_id: int, line_text: str, backup_path: str):
        """Process a single complete line or progress update from the backup process."""
        import json
        import re
        
        # Strip ANSI escape sequences (e.g., [K used by adb pull in PTY)
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        line_text = ansi_escape.sub('', line_text).strip()
        
        logger.debug(f"Backup {backup_id} processing line: {repr(line_text)}")
        if not line_text:
            return
            
        # Write to persistent log file
        try:
            log_file = os.path.join(backup_path, "processing.log")
            # We use an executor for file I/O to avoid blocking the event loop
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: open(log_file, "a", encoding="utf-8").write(line_text + "\n"))
        except Exception as e:
            logger.error(f"Failed to write log to {backup_path}: {e}")

        # Surface the passcode prompt as a dedicated UI state instead of a raw log line.
        if "*** Waiting for passcode to be entered on the device ***" in line_text:
            if backup_id in backup_tasks:
                await backup_tasks[backup_id]["queue"].put(json.dumps({
                    "type": "prompt",
                    "prompt_type": "device_passcode",
                    "message": line_text
                }))
            return

        # Skip common noisy lines
        if "Receiving file" in line_text:
            return
            
        # Check if this is a progress bar update
        is_progress = False
        progress_type = "overall"
        
        if line_text.startswith('[') and '%' in line_text:
            if 'Exiting...' not in line_text:
                is_progress = True
                if 'Finished' in line_text:
                    progress_type = "overall"
                else:
                    progress_type = "file"
                
        # Format the message
        if is_progress:
            payload = json.dumps({
                "type": "progress",
                "progress_type": progress_type,
                "message": line_text
            })
        else:
            payload = json.dumps({
                "type": "log",
                "message": line_text
            })

        logger.debug(f"Backup {backup_id} queueing payload: {payload}")
        # Stream to queue
        if backup_id in backup_tasks:
            await backup_tasks[backup_id]["queue"].put(payload)
            logger.debug(f"Backup {backup_id} successfully queued payload")
        else:
            logger.warning(f"Backup {backup_id} not in backup_tasks!")
            
        # Parse progress for database update
        if is_progress and progress_type == "overall":
            try:
                # Find the first occurrence of digits (with optional decimal) followed by %
                match = re.search(r'(\d+(?:\.\d+)?)%', line_text)
                if match:
                    percentage = int(float(match.group(1)))
                    # Throttle DB updates - only update every 5% or if 100%
                    if percentage % 5 == 0 or percentage == 100:
                        await db_execute(
                            "UPDATE backups SET progress = ? WHERE id = ?",
                            (percentage, backup_id)
                        )
            except Exception as e:
                logger.error(f"Error parsing progress: {e}")

    async def _finalize_backup(self, backup_id: int, return_code: int, backup_path: str):
        """Update DB and perform cleanup based on the process exit code."""
        # Determine final status - check if user cancelled first
        row = await db_fetch_one("SELECT status FROM backups WHERE id = ?", (backup_id,))
        
        import json
        if row is None or row['status'] == "cancelled":
            status = 'cancelled'
            try:
                log_file = os.path.join(backup_path, "processing.log")
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, lambda: open(log_file, "a", encoding="utf-8").write("Backup cancelled by user.\n"))
            except Exception:
                pass
        elif return_code == 0:
            status = 'completed'
            if backup_id in backup_tasks:
                await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": "Backup completed successfully"}))
            await broadcast_event("backup_update", {"id": backup_id, "status": "completed"})
        else:
            status = 'failed'
            if backup_id in backup_tasks:
                 await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": f"Backup failed with exit code {return_code}"}))

        if status == 'completed':
            try:
                total_size = await self.calc_backup_size(backup_path)
                size_str = f"{total_size / (1024*1024*1024):.2f} GB"
                await db_execute("UPDATE backups SET status = ?, progress = 100, size = ? WHERE id = ?",
                               (status, size_str, backup_id))
            except Exception as e:
                logger.error(f"Error calculating size for {backup_id}: {e}")
                await db_execute("UPDATE backups SET status = ?, progress = 100 WHERE id = ?", (status, backup_id))
        else:
            logger.info(f"Backup {backup_id} {status}. Cleaning up files...")
            await db_execute("UPDATE backups SET status = ? WHERE id = ?", (status, backup_id))
            await self.cleanup_backup_files(backup_path)
            
        if backup_id in backup_tasks:
            backup_tasks[backup_id]["status"] = status

    async def _handle_loop_error(self, backup_id: int, error: Exception):
        """Centralized error handling for the backup loop."""
        try:
            # Get backup path for cleanup
            row = await db_fetch_one("SELECT path FROM backups WHERE id = ?", (backup_id,))
            backup_path = row['path'] if row else None

            await db_execute("UPDATE backups SET status = 'failed' WHERE id = ?", (backup_id,))

            # Clean up files
            if backup_path:
                await self.cleanup_backup_files(backup_path)
                
            if backup_id in backup_tasks:
                import json
                await backup_tasks[backup_id]["queue"].put(json.dumps({"type": "log", "message": f"Backup error: {str(error)}"}))
                backup_tasks[backup_id]["status"] = "failed"
        except Exception as db_e:
            logger.error(f"Failed to update status on error for {backup_id}: {db_e}")

    async def calc_backup_size(self, backup_path: str) -> int:
        """Calculate total size of a backup folder asynchronously."""
        def _calc():
            total_size = 0
            if not os.path.exists(backup_path):
                return 0
            for dirpath, dirnames, filenames in os.walk(backup_path):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    if not os.path.islink(fp):
                        try:
                            total_size += os.path.getsize(fp)
                        except OSError:
                            pass 
            return total_size

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, _calc)

    async def cleanup_backup_files(self, backup_path: str):
        """Delete backup files from disk asynchronously."""
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, shutil.rmtree, backup_path)
            logger.info(f"Deleted backup directory {backup_path}")
        except FileNotFoundError:
            # Path doesn't exist, nothing to clean up
            pass
        except Exception as e:
            logger.error(f"Error deleting backup files: {e}")

    async def validate_backup(self, input_path: str) -> dict:
        """Validate an iOS backup path and check if it's encrypted."""
        # Path existence check (moved from API layer)
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Backup path not found: {input_path}")

        try:
            result = check_backup_encryption(input_path)
            logger.info(f"Validation result for {input_path}: {result}")

            if "error" in result:
                logger.warning(f"Validation error: {result['error']}")
                return {
                    "encrypted": False,
                    "error": result['error'],
                    "valid": False
                }

            return {
                "encrypted": result.get("encrypted", False),
                "valid": True
            }
        except Exception as e:
            logger.warning(f"Validation exception: {e}")
            return {
                "encrypted": False,
                "error": str(e),
                "valid": False
            }


# Global instance
backup_manager = BackupManager()
