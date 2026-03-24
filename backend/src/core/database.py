import sqlite3
import asyncio
import logging
from typing import Optional, List, Dict, Any
from pathlib import Path
from core.config import DB_PATH

logger = logging.getLogger(__name__)

# Schema Definitions
SCHEMA = {
    "profiles": """
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            tool TEXT NOT NULL DEFAULT 'ileapp',
            modules_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(name, tool)
        )
    """,
    "reports": """
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            tool TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            case_id INTEGER
        )
    """,
    "backups": """
        CREATE TABLE IF NOT EXISTS backups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            device_udid TEXT NOT NULL,
            device_name TEXT NOT NULL,
            path TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT NOT NULL,
            size TEXT,
            progress INTEGER DEFAULT 0,
            type TEXT DEFAULT 'ios',
            password TEXT,
            case_id INTEGER
        )
    """,
    "tasks": """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            description TEXT,
            priority TEXT DEFAULT 'medium',
            completed BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            case_id INTEGER
        )
    """,
    "notes": """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            case_id INTEGER
        )
    """,
    "settings": """
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """,
    "cases": """
        CREATE TABLE IF NOT EXISTS cases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            case_number TEXT,
            client_name TEXT,
            client_phone TEXT,
            client_email TEXT,
            description TEXT,
            status TEXT DEFAULT 'Active',
            priority TEXT DEFAULT 'Medium',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_visited_at TIMESTAMP
        )
    """
}

def init_database():
    """Initialize SQLite database and run migration updates."""
    data_dir = Path(DB_PATH).parent
    data_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()

    # Create tables
    for _, create_sql in SCHEMA.items():
        cursor.execute(create_sql)

    # Migrations: Add mission columns if they don't exist
    migration_columns = {
        "cases": [
            ("last_visited_at", "TIMESTAMP"),
            ("client_phone", "TEXT"),
            ("client_email", "TEXT")
        ]
    }

    for table, columns in migration_columns.items():
        for col_name, col_type in columns:
            try:
                cursor.execute(f"SELECT {col_name} FROM {table} LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}")

    conn.commit()
    conn.close()

async def db_execute(query: str, params: tuple = ()) -> None:
    """Execute a write operation (INSERT/UPDATE/DELETE) with logging."""
    logger.debug(f"SQL Execute: {query} | Params: {params}")
    loop = asyncio.get_running_loop()
    def _do():
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(query, params)
    await loop.run_in_executor(None, _do)


async def db_execute_delete(query: str, params: tuple = ()) -> int:
    """Execute a DELETE operation and return number of rows affected."""
    logger.debug(f"SQL Delete: {query} | Params: {params}")
    loop = asyncio.get_running_loop()
    def _do():
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(query, params)
            conn.commit()
            return cursor.rowcount
    rowcount = await loop.run_in_executor(None, _do)
    logger.debug(f"SQL Delete affected {rowcount} row(s)")
    return rowcount

async def db_fetch_one(query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    """Execute a read operation and return a single row as a dict."""
    logger.debug(f"SQL Fetch One: {query} | Params: {params}")
    loop = asyncio.get_running_loop()
    def _do():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(query, params).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
    return await loop.run_in_executor(None, _do)

async def db_fetch_all(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """Execute a read operation and return all rows as a list of dicts."""
    logger.debug(f"SQL Fetch All: {query} | Params: {params}")
    loop = asyncio.get_running_loop()
    def _do():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(query, params).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()
    return await loop.run_in_executor(None, _do)

async def db_execute_return_id(query: str, params: tuple = ()) -> int:
    """Execute a write operation and return the last inserted ID."""
    logger.debug(f"SQL Execute (Return ID): {query} | Params: {params}")
    loop = asyncio.get_running_loop()
    def _do():
        with sqlite3.connect(DB_PATH) as conn:
            cursor = conn.execute(query, params)
            return cursor.lastrowid
    return await loop.run_in_executor(None, _do)
