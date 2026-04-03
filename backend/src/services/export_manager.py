import os
import logging
import asyncio
import tempfile
import shutil
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from pathlib import Path

from core.database import db_execute, db_fetch_one, db_fetch_all, db_execute_return_id
from core.config import REPORTS_DIR, BACKUPS_DIR
from core.state import export_tasks
from utils.fs_ops import FileOperations

logger = logging.getLogger(__name__)

# Export retention period (hours)
EXPORT_RETENTION_HOURS = 24


def sanitize_filename(name: str) -> str:
    """Sanitize a filename by removing invalid characters."""
    # Remove path separators and other invalid chars
    sanitized = re.sub(r'[<>:"/\\|?*]', '_', name)
    # Remove leading/trailing dots and spaces
    sanitized = sanitized.strip('. ')
    # Limit length
    if len(sanitized) > 100:
        sanitized = sanitized[:100]
    return sanitized or "export"


class ExportManager:
    """Manages case export jobs and ZIP archive creation."""

    def __init__(self):
        self.active_exports: Dict[int, Dict[str, Any]] = {}

    async def get_export_job(self, job_id: int) -> Optional[Dict[str, Any]]:
        """Fetch an export job by ID."""
        return await db_fetch_one('SELECT * FROM export_jobs WHERE id = ?', (job_id,))

    async def get_active_export_for_case(self, case_id: int) -> Optional[Dict[str, Any]]:
        """Check if there's an active (pending/processing) export for a case."""
        return await db_fetch_one(
            'SELECT * FROM export_jobs WHERE case_id = ? AND status IN ("pending", "processing") ORDER BY created_at DESC LIMIT 1',
            (case_id,)
        )

    async def create_export_job(self, case_id: int) -> Dict[str, Any]:
        """Create a new export job for a case."""
        # Check for active export
        existing = await self.get_active_export_for_case(case_id)
        if existing:
            raise ValueError(f"Export already in progress for this case (job ID: {existing['id']})")

        # Verify case exists
        case = await db_fetch_one('SELECT name FROM cases WHERE id = ?', (case_id,))
        if not case:
            raise ValueError("Case not found")

        # Create job record
        job_id = await db_execute_return_id(
            'INSERT INTO export_jobs (case_id, status) VALUES (?, ?)',
            (case_id, 'pending')
        )

        # Initialize queue in export_tasks BEFORE returning to prevent race condition
        export_tasks[job_id] = {
            "queue": asyncio.Queue(maxsize=100),
            "status": "pending",
            "process": None
        }

        logger.info(f"Created export job {job_id} for case {case_id}")

        return {"job_id": job_id, "message": "Export job created"}

    async def start_export_processing(self, job_id: int) -> None:
        """Start processing an export job asynchronously."""
        job = await self.get_export_job(job_id)
        if not job:
            raise ValueError("Export job not found")

        if job['status'] != 'pending':
            raise ValueError(f"Job is not in pending state: {job['status']}")

        # Queue already initialized in create_export_job, just update status
        export_tasks[job_id]["status"] = "processing"

        # Update status to processing in DB
        await db_execute('UPDATE export_jobs SET status = ? WHERE id = ?', ('processing', job_id))

        # Start background processing
        asyncio.create_task(self._process_export(job_id, job['case_id']))

    async def _process_export(self, job_id: int, case_id: int) -> None:
        """Process the export job - create ZIP archive."""
        temp_dir = None
        queue = export_tasks.get(job_id, {}).get('queue')

        async def send_status(status: str, progress: int = None, file_path: str = None):
            """Send status update via SSE queue."""
            if queue:
                try:
                    msg = {"type": "status_update", "status": status}
                    if progress is not None:
                        msg["progress"] = progress
                    if file_path:
                        msg["file_path"] = file_path
                    await queue.put(msg)
                except Exception:
                    pass  # Queue may be full

        try:
            # Update active exports and send initial status
            self.active_exports[job_id] = {"status": "processing", "progress": 0}
            await send_status("processing", 0)

            # Get case name
            case = await db_fetch_one('SELECT name FROM cases WHERE id = ?', (case_id,))
            case_name = case['name'] if case else f"case_{case_id}"

            # Get completed reports for this case
            reports = await db_fetch_all(
                'SELECT id, name, path FROM reports WHERE case_id = ?',
                (case_id,)
            )

            # Get completed backups for this case
            backups = await db_fetch_all(
                'SELECT id, name, path FROM backups WHERE case_id = ? AND status = ?',
                (case_id, 'completed')
            )

            if not reports and not backups:
                raise ValueError("No reports or completed backups found for this case")

            # Create temp directory for this export
            temp_dir = tempfile.mkdtemp(prefix=f"export_{job_id}_")
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            zip_name = f"case_export_{sanitize_filename(case_name)}_{timestamp}.zip"
            zip_base = os.path.join(temp_dir, zip_name.replace('.zip', ''))

            # Create directory structure
            export_dir = Path(temp_dir) / "export_contents"
            export_dir.mkdir(exist_ok=True)

            reports_dir = export_dir / "reports"
            backups_dir = export_dir / "backups"
            reports_dir.mkdir(exist_ok=True)
            backups_dir.mkdir(exist_ok=True)

            # Copy reports
            await send_status("processing", 10)
            self.active_exports[job_id]["progress"] = 10
            for report in reports:
                report_path = report['path']
                if os.path.exists(report_path) and FileOperations.validate_path_security(report_path, REPORTS_DIR):
                    # Include ID to prevent name collisions
                    dest_name = f"{sanitize_filename(report['name'])}_{report['id']}"
                    dest_dir = reports_dir / dest_name
                    await asyncio.to_thread(shutil.copytree, report_path, dest_dir)

            # Copy backups
            await send_status("processing", 50)
            self.active_exports[job_id]["progress"] = 50
            for backup in backups:
                backup_path = backup['path']
                if os.path.exists(backup_path) and FileOperations.validate_path_security(backup_path, BACKUPS_DIR):
                    # Include ID to prevent name collisions
                    dest_name = f"{sanitize_filename(backup['name'])}_{backup['id']}"
                    dest_dir = backups_dir / dest_name
                    await asyncio.to_thread(shutil.copytree, backup_path, dest_dir)

            # Create ZIP archive
            await send_status("processing", 90)
            self.active_exports[job_id]["progress"] = 90
            zip_path = await asyncio.to_thread(
                shutil.make_archive,
                zip_base,
                'zip',
                export_dir
            )

            # Update job as completed
            file_path = zip_path
            await db_execute(
                'UPDATE export_jobs SET status = ?, file_path = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
                ('completed', file_path, job_id)
            )

            self.active_exports[job_id] = {"status": "completed", "file_path": file_path, "progress": 100}
            await send_status("completed", 100, file_path)
            logger.info(f"Export job {job_id} completed successfully")

        except Exception as e:
            logger.error(f"Export job {job_id} failed: {e}")
            await db_execute('UPDATE export_jobs SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?', ('failed', job_id))
            self.active_exports[job_id] = {"status": "failed", "error": str(e)}
            await send_status("failed")

            # Cleanup temp dir on failure
            if temp_dir and os.path.exists(temp_dir):
                try:
                    shutil.rmtree(temp_dir)
                except Exception:
                    pass

    async def get_job_status(self, job_id: int) -> Dict[str, Any]:
        """Get the current status of an export job."""
        # Check active job cache first
        if job_id in self.active_exports:
            return self.active_exports[job_id]

        # Fall back to DB
        job = await self.get_export_job(job_id)
        if not job:
            raise ValueError("Export job not found")

        # If job is completed and file exists, add file info
        result = {
            "status": job['status'],
            "created_at": job['created_at']
        }

        if job['status'] == 'completed' and job['file_path']:
            if os.path.exists(job['file_path']):
                result["file_path"] = job['file_path']
                result["file_size"] = os.path.getsize(job['file_path'])
            else:
                # File was cleaned up, mark as failed
                result["status"] = "failed"
                result["error"] = "Export file has expired"

        return result

    async def delete_export_job(self, job_id: int) -> None:
        """Delete an export job and its associated files."""
        job = await self.get_export_job(job_id)
        if not job:
            raise ValueError("Export job not found")

        # Delete file if exists
        if job['file_path'] and os.path.exists(job['file_path']):
            try:
                # Also cleanup the temp directory
                temp_dir = os.path.dirname(job['file_path'])
                if temp_dir and os.path.exists(temp_dir):
                    shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception as e:
                logger.error(f"Error cleaning up export file: {e}")

        # Delete from DB
        await db_execute('DELETE FROM export_jobs WHERE id = ?', (job_id,))

        # Remove from active cache
        if job_id in self.active_exports:
            del self.active_exports[job_id]

    async def cleanup_old_exports(self) -> int:
        """Clean up export jobs older than retention period."""
        cutoff = datetime.now() - timedelta(hours=EXPORT_RETENTION_HOURS)

        # Find old jobs
        old_jobs = await db_fetch_all(
            'SELECT id, file_path FROM export_jobs WHERE created_at < ?',
            (cutoff.isoformat(),)
        )

        cleaned = 0
        for job in old_jobs:
            try:
                await self.delete_export_job(job['id'])
                cleaned += 1
            except Exception as e:
                logger.error(f"Error cleaning up export job {job['id']}: {e}")

        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} old export jobs")

        return cleaned


# Global instance
export_manager = ExportManager()
