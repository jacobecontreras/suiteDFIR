"""Tests for core.database helpers and migrations."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from core.database import (
    DB_PATH,
    db_execute,
    db_execute_delete,
    db_execute_return_id,
    db_fetch_all,
    db_fetch_one,
    init_database,
)


# ---------------------------------------------------------------------------
# init_database creates schema and runs migrations
# ---------------------------------------------------------------------------

class TestInitDatabase:
    def test_creates_expected_tables(self, fresh_db):
        conn = sqlite3.connect(fresh_db)
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        conn.close()
        names = {r[0] for r in rows}
        for required in (
            "profiles", "reports", "backups", "tasks", "notes",
            "settings", "cases", "export_jobs", "photo_extractions",
        ):
            assert required in names

    def test_cases_table_includes_last_visited_at(self, fresh_db):
        conn = sqlite3.connect(fresh_db)
        cols = conn.execute("PRAGMA table_info(cases)").fetchall()
        conn.close()
        col_names = {c[1] for c in cols}
        assert "last_visited_at" in col_names
        assert "client_phone" in col_names
        assert "client_email" in col_names

    def test_migration_adds_missing_columns(self, tmp_data_dir):
        """Pre-create a cases table without migration columns; init should add them."""
        db_file = Path(DB_PATH)
        if db_file.exists():
            db_file.unlink()
        for ext in ("-wal", "-shm"):
            sib = db_file.with_name(db_file.name + ext)
            if sib.exists():
                sib.unlink()

        # Create an older-shape cases table without the migration columns
        db_file.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_file))
        conn.execute("""
            CREATE TABLE cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                case_number TEXT,
                client_name TEXT,
                description TEXT,
                status TEXT DEFAULT 'Active',
                priority TEXT DEFAULT 'Medium',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()
        conn.close()

        # Sanity: columns missing before migration
        conn = sqlite3.connect(str(db_file))
        cols_before = {c[1] for c in conn.execute("PRAGMA table_info(cases)").fetchall()}
        conn.close()
        assert "last_visited_at" not in cols_before
        assert "client_phone" not in cols_before
        assert "client_email" not in cols_before

        init_database()

        conn = sqlite3.connect(str(db_file))
        cols_after = {c[1] for c in conn.execute("PRAGMA table_info(cases)").fetchall()}
        conn.close()
        assert "last_visited_at" in cols_after
        assert "client_phone" in cols_after
        assert "client_email" in cols_after

    def test_init_is_idempotent(self, fresh_db):
        # Calling again should not blow up
        init_database()
        init_database()
        conn = sqlite3.connect(fresh_db)
        cols = {c[1] for c in conn.execute("PRAGMA table_info(cases)").fetchall()}
        conn.close()
        assert "last_visited_at" in cols


# ---------------------------------------------------------------------------
# Async helpers exercised against the real DB
# ---------------------------------------------------------------------------

class TestDbHelpers:
    async def test_execute_and_fetch_one(self, fresh_db):
        await db_execute(
            "INSERT INTO cases (name, case_number) VALUES (?, ?)",
            ("Case A", "001"),
        )
        # SQLite INSERT inside `with conn` auto-commits on context exit
        row = await db_fetch_one("SELECT name, case_number FROM cases WHERE name = ?", ("Case A",))
        assert row is not None
        assert row["name"] == "Case A"
        assert row["case_number"] == "001"

    async def test_fetch_one_returns_none_on_miss(self, fresh_db):
        row = await db_fetch_one("SELECT * FROM cases WHERE id = ?", (99999,))
        assert row is None

    async def test_execute_return_id_returns_lastrowid(self, fresh_db):
        new_id = await db_execute_return_id(
            "INSERT INTO cases (name) VALUES (?)", ("With ID",)
        )
        assert isinstance(new_id, int)
        assert new_id > 0

        row = await db_fetch_one("SELECT name FROM cases WHERE id = ?", (new_id,))
        assert row is not None
        assert row["name"] == "With ID"

    async def test_fetch_all_returns_list_of_dicts(self, fresh_db):
        for name in ("X", "Y", "Z"):
            await db_execute("INSERT INTO cases (name) VALUES (?)", (name,))

        rows = await db_fetch_all("SELECT name FROM cases ORDER BY name ASC")
        assert isinstance(rows, list)
        assert [r["name"] for r in rows] == ["X", "Y", "Z"]

    async def test_fetch_all_empty(self, fresh_db):
        rows = await db_fetch_all("SELECT * FROM cases")
        assert rows == []

    async def test_execute_delete_returns_rowcount(self, fresh_db):
        id_a = await db_execute_return_id("INSERT INTO cases (name) VALUES (?)", ("A",))
        id_b = await db_execute_return_id("INSERT INTO cases (name) VALUES (?)", ("B",))

        deleted = await db_execute_delete("DELETE FROM cases WHERE id = ?", (id_a,))
        assert deleted == 1

        # B should still be present, A should be gone
        remaining = await db_fetch_all("SELECT id FROM cases")
        ids = {r["id"] for r in remaining}
        assert id_a not in ids
        assert id_b in ids

    async def test_execute_delete_returns_zero_when_no_match(self, fresh_db):
        deleted = await db_execute_delete("DELETE FROM cases WHERE id = ?", (123456,))
        assert deleted == 0

    async def test_row_factory_dict_keys(self, fresh_db):
        await db_execute(
            "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
            ("Keyed", "Active", "High"),
        )
        row = await db_fetch_one(
            "SELECT name, status, priority FROM cases WHERE name = ?", ("Keyed",)
        )
        assert set(row.keys()) == {"name", "status", "priority"}
