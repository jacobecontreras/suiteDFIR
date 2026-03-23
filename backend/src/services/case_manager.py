
import os
import logging
import asyncio
from typing import List, Dict, Any, Optional
from core.database import db_execute, db_fetch_one, db_fetch_all, db_execute_return_id
from core.config import REPORTS_DIR, BACKUPS_DIR
from utils.fs_ops import FileOperations

logger = logging.getLogger(__name__)

class CaseManager:
    """Manages forensic cases, including database operations and filesystem cleanup."""

    async def get_cases(self) -> List[Dict[str, Any]]:
        """Get list of all cases ordered by activity."""
        return await db_fetch_all('''
            SELECT * FROM cases 
            ORDER BY COALESCE(last_visited_at, created_at) DESC
        ''')

    async def create_case(self, case_data: Dict[str, Any]) -> int:
        """Create a new case in the database."""
        return await db_execute_return_id('''
            INSERT INTO cases (
                name, case_number, 
                client_name, client_phone, client_email, description, 
                status, priority
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            case_data.get('name'), case_data.get('case_number'),
            case_data.get('client_name'), case_data.get('client_phone'), 
            case_data.get('client_email'), case_data.get('description'),
            case_data.get('status'), case_data.get('priority')
        ))

    async def get_case(self, case_id: int) -> Dict[str, Any]:
        """Fetch a specific case by ID."""
        row = await db_fetch_one('SELECT * FROM cases WHERE id = ?', (case_id,))
        if not row:
            raise ValueError(f"Case with ID {case_id} not found")
        return row

    async def update_case(self, case_id: int, update_data: Dict[str, Any]) -> bool:
        """Update an existing case."""
        if not update_data:
            return False

        # Validate column names to prevent SQL injection
        valid_columns = {
            'name', 'case_number', 'client_name', 'client_phone', 'client_email',
            'description', 'status', 'priority', 'last_visited_at'
        }
        invalid_keys = set(update_data.keys()) - valid_columns
        if invalid_keys:
            raise ValueError(f"Invalid column names: {invalid_keys}")

        set_clause = ", ".join([f"{key} = ?" for key in update_data.keys()])
        values = list(update_data.values())
        values.append(case_id)

        # Verify case exists
        await self.get_case(case_id)

        try:
            await db_execute(f'UPDATE cases SET {set_clause} WHERE id = ?', tuple(values))
            return True
        except Exception as e:
            logger.error(f"Error updating case {case_id}: {e}")
            raise

    async def visit_case(self, case_id: int) -> None:
        """Update the last_visited_at timestamp for a case."""
        # Ensure case exists
        await self.get_case(case_id)
        
        await db_execute('''
            UPDATE cases 
            SET last_visited_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        ''', (case_id,))

    async def delete_case(self, case_id: int) -> Dict[str, Any]:
        """Delete a case and perform cascading cleanup in DB and filesystem."""
        # Check if case exists
        # Check if case exists
        case = await self.get_case(case_id)

        # Fetch associated files to delete
        backup_rows = await db_fetch_all('SELECT path FROM backups WHERE case_id = ?', (case_id,))
        backup_paths = [row['path'] for row in backup_rows]

        report_rows = await db_fetch_all('SELECT path FROM reports WHERE case_id = ?', (case_id,))
        report_paths = [row['path'] for row in report_rows]

        # Delete from Database
        await db_execute('DELETE FROM backups WHERE case_id = ?', (case_id,))
        await db_execute('DELETE FROM reports WHERE case_id = ?', (case_id,))
        await db_execute('DELETE FROM tasks WHERE case_id = ?', (case_id,))
        await db_execute('DELETE FROM notes WHERE case_id = ?', (case_id,))
        await db_execute('DELETE FROM cases WHERE id = ?', (case_id,))

        # Delete from Filesystem
        errors = []
        parent_dirs = set()

        # Delete backups
        for path in backup_paths:
            if os.path.exists(path):
                try:
                    await FileOperations.delete_path(path)
                except Exception as e:
                    logger.error(f"Error deleting backup {path}: {e}")
                    errors.append(f"Failed to delete backup {os.path.basename(path)}")

        # Delete reports and track parents
        for path in report_paths:
            if os.path.exists(path):
                try:
                    parent_dirs.add(os.path.dirname(path))
                    await FileOperations.delete_path(path)
                except Exception as e:
                    logger.error(f"Error deleting report {path}: {e}")
                    errors.append(f"Failed to delete report {os.path.basename(path)}")

        # Cleanup empty parent directories
        await FileOperations.cleanup_empty_dirs(parent_dirs, REPORTS_DIR)

        return {"success": True, "errors": errors}

    async def cleanup_orphaned_files(self):
        """Scan disk and remove folders not present in the database."""
        logger.info("Starting orphaned file cleanup sweep...")
        
        # 1. Backups Sweep
        try:
            backup_rows = await db_fetch_all("SELECT path FROM backups")
            db_backup_paths = {os.path.abspath(row['path']) for row in backup_rows}
            
            if os.path.exists(BACKUPS_DIR):
                for item in os.listdir(BACKUPS_DIR):
                    item_path = os.path.join(BACKUPS_DIR, item)
                    if os.path.isdir(item_path):
                        abs_item_path = os.path.abspath(item_path)
                        if abs_item_path not in db_backup_paths:
                            logger.warning(f"Found orphaned backup: {abs_item_path}. Deleting...")
                            await FileOperations.delete_path(abs_item_path)
        except Exception as e:
            logger.error(f"Error during backup cleanup sweep: {e}")

        # 2. Reports Sweep
        try:
            report_rows = await db_fetch_all("SELECT path FROM reports")
            db_report_paths = {os.path.abspath(row['path']) for row in report_rows}
            
            if os.path.exists(REPORTS_DIR):
                parent_dirs_to_check = set()
                # We need to scan tool directories inside REPORTS_DIR
                for tool_dir in os.listdir(REPORTS_DIR):
                    tool_path = os.path.join(REPORTS_DIR, tool_dir)
                    if os.path.isdir(tool_path):
                        # Inside tool dir, check each case folder (e.g., Josh's Report)
                        for case_item in os.listdir(tool_path):
                            case_path = os.path.join(tool_path, case_item)
                            if os.path.isdir(case_path):
                                # Inside case folder, check each report instance (e.g., iLEAPP_Reports_...)
                                for instance_item in os.listdir(case_path):
                                    report_path = os.path.join(case_path, instance_item)
                                    if os.path.isdir(report_path):
                                        abs_report_path = os.path.abspath(report_path)
                                        if abs_report_path not in db_report_paths:
                                            logger.warning(f"Found orphaned report: {abs_report_path}. Deleting...")
                                            await FileOperations.delete_path(abs_report_path)
                                            parent_dirs_to_check.add(case_path)
                                    
                # 3. Cleanup empty parent (case) folders in reports
                if parent_dirs_to_check:
                    await FileOperations.cleanup_empty_dirs(parent_dirs_to_check, REPORTS_DIR)
        except Exception as e:
            logger.error(f"Error during report cleanup sweep: {e}")

        logger.info("Orphaned file cleanup sweep complete.")

# Global instance
case_manager = CaseManager()
