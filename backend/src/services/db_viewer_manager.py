import asyncio
import logging
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from core.database import db_fetch_all
from core.models import (
    DatabaseInfo,
    DatabaseSchema,
    ForeignKey,
    QueryResult,
    TableData,
    TableIndex,
    TableColumn,
    TableInfo,
    TriggerInfo,
    ViewInfo,
)

logger = logging.getLogger(__name__)

# Constants
SQLITE_HEADER = b"SQLite format 3\x00"
ALLOWED_EXTENSIONS = {".db", ".sqlite", ".sqlite3", ".db3", ""}
MAX_OPEN_DATABASES = 5
QUERY_TIMEOUT_SECONDS = 60
MAX_DISPLAY_ROWS = 10000
MAX_EXPORT_ROWS = 100000

# Allowed read-only PRAGMAs
ALLOWED_PRAGMAS = {
    "table_info",
    "index_list",
    "index_info",
    "foreign_key_list",
    "database_list",
    "table_list",
    "collation_list",
    "schema_version",
    "user_version",
    "quick_check",
    "integrity_check",
}


class InterruptibleConnection:
    """Wrapper for SQLite connection with interrupt capability."""

    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        self._deadline: Optional[float] = None
        self._deadline_lock = threading.Lock()
        self._query_lock = threading.Lock()  # Serializes query execution on this connection
        self._ref_count = 0  # Reference count to prevent closure during active queries

    def acquire(self):
        """Acquire a reference to this connection."""
        with self._query_lock:
            self._ref_count += 1

    def release(self):
        """Release a reference to this connection."""
        with self._query_lock:
            self._ref_count -= 1

    def set_deadline(self, seconds: int):
        """Set a deadline for query execution."""
        with self._deadline_lock:
            self._deadline = time.time() + seconds
            self.conn.set_progress_handler(self._check_deadline, 1000)

    def _check_deadline(self):
        """Progress handler callback that interrupts if deadline exceeded."""
        with self._deadline_lock:
            if self._deadline is not None and time.time() > self._deadline:
                self.conn.interrupt()

    def clear_deadline(self):
        """Clear the deadline and progress handler."""
        with self._deadline_lock:
            self._deadline = None
            self.conn.set_progress_handler(None, 0)

    def execute_with_deadline(self, sql: str, params: Optional[tuple] = None):
        """Execute SQL with deadline protection. Caller must call clear_deadline() after fetching."""
        self.set_deadline(QUERY_TIMEOUT_SECONDS)
        if params:
            return self.conn.execute(sql, params)
        return self.conn.execute(sql)

    def close(self):
        """Close the connection. Only closes when ref_count is 0."""
        with self._query_lock:
            if self._ref_count > 0:
                logger.debug(f"Cannot close connection with {self._ref_count} active references")
                return
            self.clear_deadline()
            self.conn.close()

    @property
    def can_close(self) -> bool:
        """Check if connection can be closed (no active references)."""
        with self._query_lock:
            return self._ref_count == 0


def _deny_write_authorizer(action_code: int, action_name: str, *args) -> int:
    """
    SQLite authorizer callback that denies all write operations.

    Args:
        action_code: SQLite operation code (e.g., sqlite3.SQLITE_INSERT)
        action_name: Name of the action (e.g., 'table', 'index')
        *args: Additional arguments depending on action

    Returns:
        sqlite3.SQLITE_DENY or sqlite3.SQLITE_OK
    """
    # Schema operations
    if action_code in (
        sqlite3.SQLITE_CREATE_TABLE,
        sqlite3.SQLITE_DROP_TABLE,
        sqlite3.SQLITE_ALTER_TABLE,
        sqlite3.SQLITE_CREATE_INDEX,
        sqlite3.SQLITE_DROP_INDEX,
        sqlite3.SQLITE_CREATE_VIEW,
        sqlite3.SQLITE_DROP_VIEW,
        sqlite3.SQLITE_CREATE_TRIGGER,
        sqlite3.SQLITE_DROP_TRIGGER,
        sqlite3.SQLITE_CREATE_VTABLE,
        sqlite3.SQLITE_DROP_VTABLE,
    ):
        return sqlite3.SQLITE_DENY

    # Data modification operations
    if action_code in (
        sqlite3.SQLITE_INSERT,
        sqlite3.SQLITE_UPDATE,
        sqlite3.SQLITE_DELETE,
        sqlite3.SQLITE_TRANSACTION,
    ):
        return sqlite3.SQLITE_DENY

    # Database operations
    if action_code in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
        return sqlite3.SQLITE_DENY

    # PRAGMA operations - only allow read-only PRAGMAs
    if action_code == sqlite3.SQLITE_PRAGMA:
        if action_name not in ALLOWED_PRAGMAS:
            return sqlite3.SQLITE_DENY

    return sqlite3.SQLITE_OK


def _is_sqlite_file(file_path: Path) -> bool:
    """
    Check if a file is a valid SQLite database by header.

    Args:
        file_path: Path to check

    Returns:
        True if file has SQLite header
    """
    # Check extension hint
    if file_path.suffix.lower() not in ALLOWED_EXTENSIONS:
        return False

    # Skip if file is too small to be a valid DB
    if file_path.stat().st_size < 100:
        return False

    try:
        with open(file_path, "rb") as f:
            header = f.read(16)
            return header == SQLITE_HEADER
    except (OSError, IOError) as e:
        logger.debug(f"Could not read file {file_path}: {e}")
        return False


def _count_statements(sql: str) -> int:
    """
    Count the number of SQL statements in a string.
    Uses simple semicolon counting (ignores semicolons in strings/comments for basic safety).
    """
    # Strip comments first
    lines = []
    for line in sql.split('\n'):
        # Strip -- comments
        if '--' in line:
            line = line.split('--')[0]
        # Strip /* */ comments (basic)
        if '/*' in line:
            line = line.split('/*')[0]
        lines.append(line)

    cleaned = '\n'.join(lines)

    # Count semicolons not in strings (basic check)
    semicolon_count = 0
    in_string = False
    string_char = None

    for char in cleaned:
        if char in ('"', "'") and (not in_string or string_char == char):
            # Check for escaped quote
            prev_char = cleaned[cleaned.index(char) - 1] if cleaned.index(char) > 0 else ''
            if prev_char != '\\':
                if in_string and string_char == char:
                    in_string = False
                    string_char = None
                elif not in_string:
                    in_string = True
                    string_char = char
        elif char == ';' and not in_string:
            semicolon_count += 1

    return semicolon_count


class DatabaseManager:
    """
    Manages SQLite database connections for the DB Viewer.
    Uses LRU cache for open connections with read-only enforcement.
    Stores case_id and report_id to resolve relative paths.
    """

    def __init__(self):
        self._connections: OrderedDict[str, InterruptibleConnection] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="db_viewer")
        self._case_report_paths: Dict[int, Dict[str, str]] = {}  # case_id -> {report_id: report_path}

    async def _load_report_paths(self, case_id: int):
        """Load report paths for a case to resolve relative database paths."""
        if case_id in self._case_report_paths:
            return

        reports = await db_fetch_all(
            "SELECT id, path FROM reports WHERE case_id = ?",
            (case_id,)
        )

        self._case_report_paths[case_id] = {r["id"]: r["path"] for r in reports}

    def _resolve_db_path(self, case_id: int, relative_path: str) -> str:
        """
        Resolve a relative database path to an absolute filesystem path.
        The relative_path format is: "report_id/rest/of/path.db"

        Raises:
            ValueError: If path escapes report directory or cannot be resolved
        """
        # Parse the report_id from the relative path
        # Format: "report_id/subpath/file.db" or just "file.db" (single report)
        parts = relative_path.split('/', 1)
        first_part = parts[0]

        # Try to find a matching report
        if case_id in self._case_report_paths:
            for report_id, report_path in self._case_report_paths[case_id].items():
                # Check if relative_path starts with report_id
                if relative_path.startswith(str(report_id) + '/'):
                    subpath = relative_path[len(str(report_id)) + 1:]
                    resolved_path = Path(report_path) / subpath
                    # Validate the resolved path is within the report directory
                    try:
                        resolved_path.resolve().relative_to(Path(report_path).resolve())
                        return str(resolved_path)
                    except ValueError:
                        # Path escapes report directory
                        raise ValueError(f"Database path escapes report directory: {relative_path}")
                # Or check if the relative_path exists directly in this report
                resolved_path = Path(report_path) / relative_path
                if resolved_path.exists():
                    try:
                        resolved_path.resolve().relative_to(Path(report_path).resolve())
                        return str(resolved_path)
                    except ValueError:
                        raise ValueError(f"Database path escapes report directory: {relative_path}")

        # Fallback: try all report directories
        if case_id in self._case_report_paths:
            for report_path in self._case_report_paths[case_id].values():
                resolved_path = Path(report_path) / relative_path
                if resolved_path.exists():
                    try:
                        resolved_path.resolve().relative_to(Path(report_path).resolve())
                        return str(resolved_path)
                    except ValueError:
                        raise ValueError(f"Database path escapes report directory: {relative_path}")

        raise ValueError(f"Could not resolve database path: {relative_path}")

    def _get_connection(self, db_path: str) -> InterruptibleConnection:
        """Get or create a cached connection for the database path."""
        with self._cache_lock:
            # Return existing connection if available
            if db_path in self._connections:
                self._connections.move_to_end(db_path)
                return self._connections[db_path]

            # Enforce LRU cache limit, skip connections with active queries
            evicted = []
            while len(self._connections) >= MAX_OPEN_DATABASES:
                oldest_db, oldest_conn = self._connections.popitem(last=False)
                if oldest_conn.can_close:
                    try:
                        oldest_conn.close()
                    except Exception as e:
                        logger.debug(f"Error closing database {oldest_db}: {e}")
                    break
                else:
                    # Can't close this one, save it and try the next oldest
                    evicted.append((oldest_db, oldest_conn))
                    if len(self._connections) == 0:
                        # All connections are busy, allow exceeding limit temporarily
                        logger.warning("All database connections are busy, exceeding cache limit")
                        break

            # Put back any connections we couldn't close
            for db, conn in evicted:
                self._connections[db] = conn

            # Create new read-only connection
            try:
                conn = sqlite3.connect(
                    f"file:{db_path}?mode=ro",
                    uri=True,
                    check_same_thread=False,
                )
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA query_only=ON")
                conn.set_authorizer(_deny_write_authorizer)

                wrapper = InterruptibleConnection(conn)
                self._connections[db_path] = wrapper
                return wrapper

            except Exception as e:
                logger.error(f"Failed to open database {db_path}: {e}")
                raise

    async def find_databases(self, case_id: int) -> List[DatabaseInfo]:
        """
        Find all SQLite databases within a case's reports.

        Args:
            case_id: The case ID to search

        Returns:
            List of DatabaseInfo objects with report_id-prefixed relative paths
        """
        try:
            # Query for report paths
            reports = await db_fetch_all(
                "SELECT id, path, name FROM reports WHERE case_id = ?",
                (case_id,)
            )

            databases = []

            for report in reports:
                report_id = report["id"]
                report_path = Path(report["path"])

                # Update cache for path resolution
                if case_id not in self._case_report_paths:
                    self._case_report_paths[case_id] = {}
                self._case_report_paths[case_id][report_id] = str(report_path)

                if not report_path.exists():
                    continue

                # Recursively scan for SQLite files
                for root, dirs, files in os.walk(report_path):
                    root_path = Path(root)

                    # Skip common non-database directories
                    # Note: _HTML and _Timeline may contain databases, so don't skip those
                    dirs[:] = [d for d in dirs if d not in {
                        "_Logs", "_TSV Exports", "_KML Exports", "output", "temp", "tmp", "Script Logs"
                    }]

                    for filename in files:
                        file_path = root_path / filename
                        if _is_sqlite_file(file_path):
                            try:
                                rel_path_from_report = file_path.relative_to(report_path)
                                # Store as report_id/relative_path for uniqueness
                                storage_path = f"{report_id}/{rel_path_from_report}"
                                size = file_path.stat().st_size

                                db_info = DatabaseInfo(
                                    name=filename,
                                    relativePath=storage_path,
                                    size=size
                                )
                                databases.append(db_info)
                            except Exception as e:
                                logger.debug(f"Error processing database {file_path}: {e}")

            return databases

        except Exception as e:
            logger.error(f"Error finding databases for case {case_id}: {e}")
            raise

    async def get_database_schema(self, case_id: int, relative_path: str) -> DatabaseSchema:
        """
        Get the complete schema for a database.

        Args:
            case_id: The case ID
            relative_path: The relative path from DatabaseInfo

        Returns:
            DatabaseSchema object
        """
        await self._load_report_paths(case_id)
        db_path = self._resolve_db_path(case_id, relative_path)

        loop = asyncio.get_event_loop()

        def _get_schema() -> DatabaseSchema:
            wrapper = self._get_connection(db_path)
            wrapper.acquire()
            try:
                with wrapper._query_lock:
                    conn = wrapper.conn

                    tables = []
                    indexes = []
                    views = []
                    triggers = []

                    try:
                        # Get all tables, views, indexes, triggers from sqlite_master
                        cursor = wrapper.execute_with_deadline("""
                            SELECT type, name, sql, tbl_name
                            FROM sqlite_master
                            WHERE type IN ('table', 'index', 'view', 'trigger')
                            AND name NOT LIKE 'sqlite_%'
                            ORDER BY type, name
                        """)

                        for row in cursor.fetchall():
                            obj_type = row["type"]
                            name = row["name"]
                            sql = row["sql"]
                            table_name = row["tbl_name"]

                            if obj_type == "table":
                                # Get detailed table info
                                table_info = self._get_table_info(wrapper, name, sql)
                                tables.append(table_info)
                            elif obj_type == "index":
                                index_info = TriggerInfo(name=name, sql=sql or "")
                                indexes.append(index_info)
                            elif obj_type == "view":
                                views.append(ViewInfo(name=name, sql=sql or ""))
                            elif obj_type == "trigger":
                                triggers.append(TriggerInfo(
                                    name=name,
                                    sql=sql or "",
                                    table=table_name
                                ))

                    except Exception as e:
                        logger.error(f"Error getting schema for {db_path}: {e}")
                        raise
                    finally:
                        wrapper.clear_deadline()

                    return DatabaseSchema(
                        tables=tables,
                        indexes=indexes,
                        views=views,
                        triggers=triggers
                    )
            finally:
                wrapper.release()

        return await loop.run_in_executor(self._executor, _get_schema)

    def _get_table_info(self, wrapper: InterruptibleConnection, table_name: str, sql: Optional[str]) -> TableInfo:
        """Get detailed information about a table."""
        conn = wrapper.conn
        # Get columns - use separate variable name to avoid collision
        pragma_result = wrapper.execute_with_deadline(f"PRAGMA table_info('{table_name}')")
        table_columns = []
        for row in pragma_result.fetchall():
            table_columns.append(TableColumn(
                cid=row[0],
                name=row[1],
                type=row[2] or "",
                notNull=row[3] == 1,
                defaultValue=row[4],
                primaryKeyPosition=row[5] or 0,
            ))

        # Get indexes
        index_result = wrapper.execute_with_deadline(f"PRAGMA index_list('{table_name}')")
        indexes = []
        for row in index_result.fetchall():
            index_name = row[1]
            unique = row[2] == 1
            origin = row[3] or ""
            partial = row[4] == 1

            # Get index columns - use separate variable name
            cols_result = wrapper.execute_with_deadline(f"PRAGMA index_info('{index_name}')")
            index_columns = [col[2] for col in cols_result.fetchall()]

            indexes.append(TableIndex(
                name=index_name,
                unique=unique,
                origin=origin,
                partial=partial,
                columns=index_columns,
            ))

        # Get foreign keys
        fk_result = wrapper.execute_with_deadline(f"PRAGMA foreign_key_list('{table_name}')")
        foreign_keys = []
        for row in fk_result.fetchall():
            foreign_keys.append(ForeignKey(
                table=row[2] or "",
                from_column=row[3] or "",
                to=row[4] or "",
                on_update=row[5] or "",
                on_delete=row[6] or "",
                match=row[7] or "",
            ))

        # Get row count
        try:
            count_result = wrapper.execute_with_deadline(f"SELECT COUNT(*) FROM '{table_name}'")
            row_count = count_result.fetchone()[0]
        except Exception:
            row_count = 0

        return TableInfo(
            name=table_name,
            sql=sql,
            columns=table_columns,
            indexes=indexes,
            foreignKeys=foreign_keys,
            rowCount=row_count,
        )

    async def get_table_data(
        self,
        case_id: int,
        relative_path: str,
        table_name: str,
        page: int,
        page_size: int,
        global_filter: Optional[str] = None,
        sort_column: Optional[str] = None,
        sort_direction: Optional[str] = None,
    ) -> TableData:
        """
        Get paginated table data with optional filtering and sorting.
        """
        await self._load_report_paths(case_id)
        db_path = self._resolve_db_path(case_id, relative_path)

        loop = asyncio.get_event_loop()

        def _get_data() -> TableData:
            wrapper = self._get_connection(db_path)
            wrapper.acquire()
            try:
                with wrapper._query_lock:
                    try:
                        conn = wrapper.conn

                        # Get columns
                        pragma_result = wrapper.execute_with_deadline(f"PRAGMA table_info('{table_name}')")
                        columns = [row[1] for row in pragma_result.fetchall()]

                        if not columns:
                            return TableData(
                                columns=[],
                                rows=[],
                                rowCount=0,
                                page=page,
                                pageSize=page_size
                            )

                        # Build query
                        base_query = f'SELECT * FROM "{table_name}"'
                        count_query = f'SELECT COUNT(*) FROM "{table_name}"'

                        # Add filter
                        where_clause = ""
                        params = []

                        if global_filter and global_filter.strip():
                            filter_conditions = []
                            for col in columns:
                                filter_conditions.append(f'CAST("{col}" AS TEXT) LIKE ?')
                            where_clause = " WHERE " + " OR ".join(filter_conditions)
                            filter_value = f"%{global_filter}%"
                            params = [filter_value] * len(columns)

                        # Add sorting
                        order_clause = ""
                        if sort_column and sort_column in columns:
                            direction = "DESC" if sort_direction == "desc" else "ASC"
                            order_clause = f' ORDER BY "{sort_column}" {direction}'

                        # Get total count
                        count_sql = count_query + where_clause
                        count_result = wrapper.execute_with_deadline(count_sql, tuple(params))
                        row_count = count_result.fetchone()[0]

                        # Get paginated data
                        offset = page * page_size
                        data_sql = base_query + where_clause + order_clause + f" LIMIT {page_size} OFFSET {offset}"
                        data_result = wrapper.execute_with_deadline(data_sql, tuple(params))

                        rows = []
                        for row in data_result.fetchall():
                            rows.append([row[col] for col in columns])

                        return TableData(
                            columns=columns,
                            rows=rows,
                            rowCount=row_count,
                            page=page,
                            pageSize=page_size,
                        )

                    finally:
                        wrapper.clear_deadline()
            finally:
                wrapper.release()

        return await loop.run_in_executor(self._executor, _get_data)

    async def execute_query(self, case_id: int, relative_path: str, sql: str, max_rows: int = MAX_DISPLAY_ROWS) -> QueryResult:
        """
        Execute a read-only SQL query.
        """
        await self._load_report_paths(case_id)
        db_path = self._resolve_db_path(case_id, relative_path)

        loop = asyncio.get_event_loop()

        def _execute() -> QueryResult:
            wrapper = self._get_connection(db_path)
            wrapper.acquire()
            try:
                with wrapper._query_lock:
                    try:
                        conn = wrapper.conn

                        # Trim and validate
                        sql_query = sql.strip()
                        if not sql_query:
                            raise ValueError("Empty SQL query")

                        # Validate single statement
                        if _count_statements(sql_query) > 1:
                            raise ValueError("Only single SQL statements are allowed")

                        # Execute with timing
                        start_time = time.time()
                        cursor = wrapper.execute_with_deadline(sql_query)
                        duration_ms = int((time.time() - start_time) * 1000)

                        columns = [desc[0] for desc in cursor.description] if cursor.description else []
                        rows = []
                        row_count = 0

                        for row in cursor.fetchall():
                            if row_count >= max_rows:
                                break
                            rows.append(list(row))
                            row_count += 1

                        return QueryResult(
                            columns=columns,
                            rows=rows,
                            rowCount=row_count,
                            durationMs=duration_ms,
                        )

                    except sqlite3.OperationalError as e:
                        if "interrupted" in str(e).lower():
                            raise TimeoutError("Query execution timed out")
                        raise
                    except Exception as e:
                        raise
                    finally:
                        wrapper.clear_deadline()
            finally:
                wrapper.release()

        return await loop.run_in_executor(self._executor, _execute)

    async def export_query(
        self,
        case_id: int,
        relative_path: str,
        sql: str,
        format_type: str,
        max_rows: int = MAX_EXPORT_ROWS,
    ) -> str:
        """
        Export query results as CSV or JSON.
        """
        await self._load_report_paths(case_id)
        db_path = self._resolve_db_path(case_id, relative_path)

        loop = asyncio.get_event_loop()

        def _export() -> str:
            wrapper = self._get_connection(db_path)
            wrapper.acquire()
            try:
                with wrapper._query_lock:
                    try:
                        conn = wrapper.conn

                        # For exports, allow larger row limit
                        result = wrapper.execute_with_deadline(sql)
                        columns = [desc[0] for desc in result.description] if result.description else []

                        if format_type == "csv":
                            import csv
                            import io

                            output = io.StringIO()
                            writer = csv.writer(output)

                            writer.writerow(columns)
                            row_count = 0

                            for row in result:
                                if row_count >= max_rows:
                                    break
                                writer.writerow(row)
                                row_count += 1

                            return output.getvalue()

                        else:  # JSON
                            import json

                            rows = []
                            row_count = 0

                            for row in result:
                                if row_count >= max_rows:
                                    break
                                row_dict = dict(zip(columns, row))
                                rows.append(row_dict)
                                row_count += 1

                            return json.dumps(rows, indent=2, default=str)

                    except sqlite3.OperationalError as e:
                        if "interrupted" in str(e).lower():
                            raise TimeoutError("Export timed out")
                        raise
                    except Exception as e:
                        raise
                    finally:
                        wrapper.clear_deadline()
            finally:
                wrapper.release()

        return await loop.run_in_executor(self._executor, _export)

    def close_all(self):
        """Close all cached database connections."""
        with self._cache_lock:
            for db_path, wrapper in self._connections.items():
                try:
                    wrapper.close()
                except Exception as e:
                    logger.debug(f"Error closing database {db_path}: {e}")
            self._connections.clear()


# Global singleton instance
db_viewer_manager = DatabaseManager()
