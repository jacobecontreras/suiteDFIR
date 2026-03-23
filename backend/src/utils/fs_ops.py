"""
Filesystem operation utilities.

Provides common async filesystem operations used across managers.
Extracted to eliminate DRY violations in case_manager, report_manager,
backup_manager, and system_manager.
"""

import asyncio
import logging
import os
import shutil
from pathlib import Path
from typing import Set, Union

logger = logging.getLogger(__name__)


class FileOperations:
    """Common async filesystem operations used across managers."""

    @staticmethod
    async def delete_path(path: Union[str, Path]) -> None:
        """
        Asynchronously delete a file or directory.

        Extracted from:
        - case_manager.py:_delete_path
        - report_manager.py:_delete_path
        - backup_manager.py:cleanup_backup_files (partial)
        """
        path = Path(path)

        def _do_delete():
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _do_delete)

    @staticmethod
    async def calc_directory_size(path: Union[str, Path]) -> int:
        """
        Calculate total size of a directory asynchronously.

        Returns size in bytes.

        Extracted from:
        - report_manager.py:_calculate_report_stats
        - backup_manager.py:calc_backup_size
        - system_manager.py:_calc_directory_size
        """
        path = Path(path)

        def _calc():
            if path.is_file():
                return path.stat().st_size

            total_size = 0
            for dirpath, _, filenames in os.walk(path):
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

    @staticmethod
    async def cleanup_empty_dirs(
        parent_dirs: Set[Union[str, Path]],
        root_dir: Union[str, Path]
    ) -> None:
        """
        Recursively remove empty parent directories.

        Ensures we don't delete upward beyond the root directory.

        Extracted from:
        - case_manager.py:_cleanup_empty_dirs
        - report_manager.py:_cleanup_empty_parents
        """
        root_dir = Path(root_dir).resolve()

        def _cleanup():
            for parent_dir in parent_dirs:
                parent = Path(parent_dir)

                if not parent.exists() or not parent.is_dir():
                    continue

                try:
                    parent_resolved = parent.resolve()
                    rel = parent_resolved.relative_to(root_dir)

                    # Safety check: don't delete root or direct child of root
                    if rel == "." or str(rel.parent) == ".":
                        continue

                    # Only delete if empty
                    if not os.listdir(parent):
                        os.rmdir(parent)
                        logger.info(f"Removed empty directory: {parent}")
                except ValueError:
                    # Path is not relative to root_dir
                    logger.warning(f"Skipping directory outside root: {parent}")
                except Exception as e:
                    logger.error(f"Error cleaning up directory {parent}: {e}")

        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _cleanup)

    @staticmethod
    def validate_path_security(
        path: Union[str, Path],
        allowed_dir: Union[str, Path]
    ) -> bool:
        """
        Ensure a path is within an allowed directory.

        Returns True if path is within allowed_dir, False otherwise.

        Used for security checks to prevent directory traversal attacks.
        Extracted from:
        - case_manager.py (implicit in delete_case)
        - report_manager.py:prepare_report_file
        - helpers.py:open_path_secured
        """
        try:
            return Path(path).resolve().is_relative_to(Path(allowed_dir).resolve())
        except ValueError:
            # Path is not relative to allowed_dir
            return False

    @staticmethod
    def is_path_within_allowed(
        path: Union[str, Path],
        allowed_dir: Union[str, Path]
    ) -> bool:
        """
        Alias for validate_path_security for backward compatibility.

        Deprecated: Use validate_path_security instead.
        """
        return FileOperations.validate_path_security(path, allowed_dir)
