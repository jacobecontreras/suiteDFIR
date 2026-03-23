import os
import logging
import asyncio
import re
import mimetypes
import tempfile
import shutil
from typing import List, Dict, Any, Optional
from core.database import db_execute, db_fetch_all
from core.config import REPORTS_DIR
from utils.helpers import get_size_format
from utils.constants import SCROLL_TRACKING_SCRIPT
from utils.fs_ops import FileOperations

logger = logging.getLogger(__name__)


class ReportManager:
    """Manages forensic report data and filesystem operations."""

    async def get_reports(self, case_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get reports from DB for case with computed stats (size, file count, URL)."""
        if not case_id:
            return []
        rows = await db_fetch_all(
            'SELECT id, name, path, tool, created_at FROM reports WHERE case_id = ? ORDER BY created_at DESC',
            (case_id,)
        )

        reports = []
        for row in rows:
            path = row['path']
            
            if not os.path.exists(path):
                continue

            try:
                stats = await self._calculate_report_stats(path)
                
                # Calculate relative path for URL
                rel_path = os.path.relpath(path, REPORTS_DIR)
                # Sanitize path to prevent directory traversal attacks
                safe_rel_path = rel_path.replace('..', '').replace('\\', '/')
                url = f"/api/reports/{row['id']}/view/index.html"

                reports.append({
                    "id": row['id'],
                    "name": row['name'],
                    "path": path,
                    "url": url,
                    "tool": row['tool'],
                    "created_at": row['created_at'],
                    "size": stats['size'],
                    "artifact_count": stats['file_count']
                })
            except Exception as e:
                logger.error(f"Error processing report {row['name']}: {e}")
                continue

        return reports

    async def get_report(self, report_id: int) -> Optional[Dict[str, Any]]:
        """Fetch a specific report by ID."""
        from core.database import db_fetch_one
        row = await db_fetch_one('SELECT * FROM reports WHERE id = ?', (report_id,))
        return dict(row) if row else None

    async def delete_report(self, report_id: int) -> Dict[str, Any]:
        """Delete a report from DB and filesystem by ID"""
        report = await self.get_report(report_id)
        if not report:
            raise FileNotFoundError("Report not found")
        
        path = report['path']

        # Security check: ensure path is within reports directory
        if not FileOperations.validate_path_security(path, REPORTS_DIR):
            raise PermissionError("Access denied")

        # Delete from DB first
        await db_execute("DELETE FROM reports WHERE id = ?", (report_id,))

        # Delete from filesystem
        if os.path.exists(path):
            try:
                await self._delete_path(path)
                
                # Cleanup empty parent directories recursively
                await self._cleanup_empty_parents(os.path.dirname(path))
                
                return {"message": "Report deleted successfully"}
            except Exception as e:
                logger.error(f"Error deleting report files at {path}: {e}")
                # We still consider it a success if DB is cleared, but maybe log it?
                # The original code returned success: True even on FS error.
                # We will just return the message as strictly requested by the plan
                return {"message": "Report deleted from DB (filesystem error)"}
        else:
            return {"message": "Report deleted from DB (file not found on disk)"}

    async def _calculate_report_stats(self, path: str) -> Dict[str, Any]:
        """Calculate size and file count for a report directory."""
        total_size = await FileOperations.calc_directory_size(path)

        # Count files separately
        def _count_files():
            file_count = 0
            for dirpath, _, filenames in os.walk(path):
                file_count += len(filenames)
            return file_count

        loop = asyncio.get_running_loop()
        file_count = await loop.run_in_executor(None, _count_files)

        return {"size": get_size_format(total_size), "file_count": file_count}

    async def _delete_path(self, path: str):
        """Asynchronously delete a file or directory."""
        await FileOperations.delete_path(path)

    async def _cleanup_empty_parents(self, parent_path: str):
        """Recursively remove empty parent directories up to REPORTS_DIR."""
        await FileOperations.cleanup_empty_dirs({parent_path}, REPORTS_DIR)

    async def prepare_report_file(self, report_id: int, file_path: str) -> Dict[str, Any]:
        """
        Prepare a report file for serving by report ID and relative path.
        Returns dict with 'content', 'media_type', 'is_html', and 'headers'.
        """
        report = await self.get_report(report_id)
        if not report:
            raise FileNotFoundError("Report not found")
        
        report_root = report['path']
        full_path = os.path.join(report_root, file_path)

        # Security check: ensure the file is actually inside THIS report's directory
        if not FileOperations.validate_path_security(full_path, report_root):
            raise PermissionError("Access denied")

        if not os.path.exists(full_path):
            raise FileNotFoundError("File not found")

        if os.path.isdir(full_path):
            full_path = os.path.join(full_path, "index.html")
            if not os.path.exists(full_path):
                raise FileNotFoundError("index.html not found")

        content_type, _ = mimetypes.guess_type(full_path)
        if content_type is None:
            content_type = "application/octet-stream"

        is_html = full_path.endswith('.html') or full_path.endswith('.htm')

        if is_html:
            try:
                with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()

                if '</body>' in content.lower():
                    content = re.sub(
                        r'(</body>)',
                        SCROLL_TRACKING_SCRIPT + r'\1',
                        content, count=1, flags=re.IGNORECASE
                    )
                else:
                    content += SCROLL_TRACKING_SCRIPT

                return {
                    "content": content,
                    "media_type": "text/html",
                    "is_html": True,
                    "headers": {
                        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                        "Pragma": "no-cache",
                        "Expires": "0"
                    }
                }
            except Exception as e:
                logger.error(f"Error reading report file {full_path}: {e}")
                raise RuntimeError(f"Failed to read file: {str(e)}")

        return {
            "file_path": full_path,
            "media_type": content_type,
            "is_html": False
        }

    async def create_zip_archive(self, report_id: int) -> Dict[str, Any]:
        """Create a zip archive of the report directory by ID. Returns dict with zip_path, filename or error."""
        report = await self.get_report(report_id)
        if not report:
            raise FileNotFoundError("Report not found")
        
        path = report['path']
        if not os.path.exists(path):
             raise FileNotFoundError("Report directory not found on disk")

        # Security check
        if not FileOperations.validate_path_security(path, REPORTS_DIR):
            raise PermissionError("Access denied")

        def _zip():
            temp_dir = None
            try:
                temp_dir = tempfile.mkdtemp()
                zip_name = f"{os.path.basename(path)}.zip"
                zip_path = os.path.join(temp_dir, zip_name)
                # make_archive appends .zip automatically if not present in base_name,
                # but here we are specifying the full path for base_name without extension for make_archive
                base_name = os.path.splitext(zip_path)[0]
                shutil.make_archive(base_name, 'zip', path)
                # make_archive returns the full path of the created file
                final_zip_path = base_name + ".zip"
                return {"zip_path": final_zip_path, "filename": zip_name, "temp_dir": temp_dir}
            except Exception as e:
                # Cleanup on failure
                if temp_dir and os.path.exists(temp_dir):
                    try:
                        shutil.rmtree(temp_dir)
                    except Exception:
                        pass
                raise

        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, _zip)
            # Note: temp_dir cleanup is handled by the caller after serving the file
            return result
        except Exception as e:
            logger.error(f"Error zipping report: {e}")
            raise RuntimeError(f"Failed to zip report: {str(e)}")


# Global instance
report_manager = ReportManager()
