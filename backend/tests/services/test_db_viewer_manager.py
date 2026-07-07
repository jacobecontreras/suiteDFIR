"""
Tests for services/db_viewer_manager.py.

Strategy: build real SQLite database files inside the per-test temp report
directory (no mocks of sqlite). The manager resolves database paths via the
`reports` table; tests insert a real reports row pointing at a directory we
control, then exercise the public async API of `db_viewer_manager`.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import pytest

from core.database import db_execute_return_id
from services.case_manager import case_manager
from services.db_viewer_manager import (
    DatabaseManager,
    _count_statements,
    _is_sqlite_file,
    db_viewer_manager,
)


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
async def case_with_report(fresh_db, tmp_data_dir):
    """
    Insert a case + a reports row whose `path` points at a real directory
    inside the session temp tree. Returns (case_id, report_id, report_dir).

    We must construct things in this order because db_viewer_manager caches
    report paths the first time it sees a case_id; each test wants a clean
    slate, so we also clear that cache.
    """
    case_id = await case_manager.create_case(
        {
            "name": "DB Viewer Case",
            "case_number": "DBV-001",
            "status": "Active",
            "priority": "Medium",
        }
    )

    report_dir = tmp_data_dir / "reports" / f"case-{case_id}-report"
    # `tmp_data_dir` is session-scoped and `case_id` repeats across tests
    # (the db is reset by `fresh_db`), so wipe any stale contents first.
    if report_dir.exists():
        import shutil
        shutil.rmtree(report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)

    report_id = await db_execute_return_id(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("Test Report", str(report_dir), "ileapp", case_id),
    )

    # Clear any cached path mapping from a prior test run.
    db_viewer_manager._case_report_paths.pop(case_id, None)

    yield case_id, report_id, report_dir

    # Cleanup: drop cached connections so we don't leak file handles between
    # tests (and clear path cache).
    db_viewer_manager.close_all()
    db_viewer_manager._case_report_paths.pop(case_id, None)


@pytest.fixture
async def populated_case(case_with_report, make_sample_db):
    """As above, plus a real sample.db with the standard schema."""
    case_id, report_id, report_dir = case_with_report
    db_file = report_dir / "sample.db"
    make_sample_db(db_file)
    rel_path = f"{report_id}/sample.db"
    return case_id, report_id, report_dir, rel_path


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------
class TestIsSqliteFile:
    def test_detects_real_sqlite_file(self, tmp_data_dir, make_sample_db):
        target = tmp_data_dir / "data" / "imports" / "valid.db"
        make_sample_db(target)
        assert _is_sqlite_file(target) is True

    def test_rejects_non_sqlite_file(self, tmp_data_dir):
        bogus = tmp_data_dir / "data" / "imports" / "fake.db"
        bogus.parent.mkdir(parents=True, exist_ok=True)
        bogus.write_bytes(b"not a sqlite header" * 20)
        assert _is_sqlite_file(bogus) is False

    def test_rejects_too_small_file(self, tmp_data_dir):
        small = tmp_data_dir / "data" / "imports" / "tiny.db"
        small.parent.mkdir(parents=True, exist_ok=True)
        small.write_bytes(b"SQLite format 3\x00")  # exactly 16 bytes, < 100
        assert _is_sqlite_file(small) is False

    def test_rejects_disallowed_extension(self, tmp_data_dir, make_sample_db):
        target = tmp_data_dir / "data" / "imports" / "valid.txt"
        make_sample_db(target.with_suffix(".db"))
        # copy bytes over to a .txt extension
        target.write_bytes((target.with_suffix(".db")).read_bytes())
        assert _is_sqlite_file(target) is False


class TestCountStatements:
    def test_single_statement(self):
        assert _count_statements("SELECT 1") == 0  # no terminating ;
        assert _count_statements("SELECT 1;") == 1

    def test_multiple_statements(self):
        assert _count_statements("SELECT 1; SELECT 2;") == 2

    def test_semicolon_inside_string_not_counted(self):
        # Surprise pin: the implementation's string-aware logic is naive
        # (uses .index() on the first occurrence of the quote char), so this
        # behavior is what we lock in, not what we wish were true.
        assert _count_statements("SELECT ';' AS x") == 0


# ---------------------------------------------------------------------------
# find_databases — schema introspection of the FS
# ---------------------------------------------------------------------------
class TestFindDatabases:
    async def test_finds_db_files_recursively(self, case_with_report, make_sample_db):
        case_id, report_id, report_dir = case_with_report
        make_sample_db(report_dir / "top.db")
        make_sample_db(report_dir / "nested" / "deep.db")

        result = await db_viewer_manager.find_databases(case_id)
        names = sorted(d.name for d in result)
        assert names == ["deep.db", "top.db"]

        # storage path is report_id-prefixed
        paths = {d.relativePath for d in result}
        assert f"{report_id}/top.db" in paths
        assert f"{report_id}/nested/deep.db" in paths

    async def test_skips_non_sqlite_files(self, case_with_report, make_sample_db):
        case_id, report_id, report_dir = case_with_report
        make_sample_db(report_dir / "real.db")
        (report_dir / "notes.txt").write_text("just text")
        (report_dir / "fake.db").write_bytes(b"xxxxx" * 50)

        result = await db_viewer_manager.find_databases(case_id)
        assert [d.name for d in result] == ["real.db"]

    async def test_skips_excluded_directories(self, case_with_report, make_sample_db):
        case_id, report_id, report_dir = case_with_report
        make_sample_db(report_dir / "kept.db")
        make_sample_db(report_dir / "_Logs" / "skipped.db")
        make_sample_db(report_dir / "_TSV Exports" / "skipped2.db")

        result = await db_viewer_manager.find_databases(case_id)
        names = {d.name for d in result}
        assert names == {"kept.db"}

    async def test_returns_size(self, case_with_report, make_sample_db):
        case_id, report_id, report_dir = case_with_report
        db_file = report_dir / "size.db"
        make_sample_db(db_file)

        result = await db_viewer_manager.find_databases(case_id)
        [info] = result
        assert info.size == db_file.stat().st_size

    async def test_returns_empty_when_no_reports(self, fresh_db, tmp_data_dir):
        case_id = await case_manager.create_case({"name": "Empty case"})
        result = await db_viewer_manager.find_databases(case_id)
        assert result == []


# ---------------------------------------------------------------------------
# get_database_schema
# ---------------------------------------------------------------------------
class TestGetDatabaseSchema:
    async def test_returns_tables_columns_indexes_views_triggers(self, populated_case):
        case_id, report_id, report_dir, rel_path = populated_case

        schema = await db_viewer_manager.get_database_schema(case_id, rel_path)

        table_names = {t.name for t in schema.tables}
        assert table_names == {"users", "posts"}

        users = next(t for t in schema.tables if t.name == "users")
        col_names = [c.name for c in users.columns]
        assert col_names == ["id", "name", "email"]
        # `name` is NOT NULL
        name_col = next(c for c in users.columns if c.name == "name")
        assert name_col.notNull is True
        # `id` is the PK (primaryKeyPosition > 0)
        id_col = next(c for c in users.columns if c.name == "id")
        assert id_col.primaryKeyPosition == 1

        # row counts
        assert users.rowCount == 3
        posts = next(t for t in schema.tables if t.name == "posts")
        assert posts.rowCount == 3

        # foreign keys on `posts`
        assert any(fk.table == "users" for fk in posts.foreignKeys)

        # at least one index on users (explicit + auto for PK)
        idx_names = {i.name for i in users.indexes}
        assert "idx_users_email" in idx_names

        # views & triggers
        assert any(v.name == "user_post_counts" for v in schema.views)
        assert any(tr.name == "trg_users_noop" for tr in schema.triggers)

    async def test_bad_relative_path_raises_value_error(self, populated_case):
        case_id, *_ = populated_case
        with pytest.raises(ValueError):
            await db_viewer_manager.get_database_schema(case_id, "9999/nonexistent.db")


# ---------------------------------------------------------------------------
# get_table_data — pagination, filter, sort
# ---------------------------------------------------------------------------
class TestGetTableData:
    async def test_pagination_first_page(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        data = await db_viewer_manager.get_table_data(
            case_id, rel, "users", page=0, page_size=2
        )
        assert data.columns == ["id", "name", "email"]
        assert len(data.rows) == 2
        assert data.rowCount == 3  # total, not page-limited
        assert data.page == 0
        assert data.pageSize == 2

    async def test_pagination_second_page(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        data = await db_viewer_manager.get_table_data(
            case_id, rel, "users", page=1, page_size=2
        )
        assert len(data.rows) == 1
        assert data.rowCount == 3

    async def test_out_of_range_page_returns_empty(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        data = await db_viewer_manager.get_table_data(
            case_id, rel, "users", page=99, page_size=10
        )
        assert data.rows == []
        assert data.rowCount == 3  # but total still reflects the table

    async def test_global_filter_substring(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        data = await db_viewer_manager.get_table_data(
            case_id, rel, "users", page=0, page_size=50,
            global_filter="example.com",
        )
        # Alice + Bob match, Carol does not
        names = sorted(r[1] for r in data.rows)
        assert names == ["Alice", "Bob"]
        assert data.rowCount == 2

    async def test_sort_asc_and_desc(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        asc = await db_viewer_manager.get_table_data(
            case_id, rel, "users", page=0, page_size=50,
            sort_column="name", sort_direction="asc",
        )
        assert [r[1] for r in asc.rows] == ["Alice", "Bob", "Carol"]

        desc = await db_viewer_manager.get_table_data(
            case_id, rel, "users", page=0, page_size=50,
            sort_column="name", sort_direction="desc",
        )
        assert [r[1] for r in desc.rows] == ["Carol", "Bob", "Alice"]

    async def test_unknown_sort_column_is_ignored(self, populated_case):
        # Behavior pin: invalid sort_column is silently dropped (not 4xx).
        case_id, _rid, _rdir, rel = populated_case
        data = await db_viewer_manager.get_table_data(
            case_id, rel, "users", page=0, page_size=50,
            sort_column="nonexistent_col", sort_direction="asc",
        )
        assert data.rowCount == 3

    async def test_nonexistent_table_returns_empty_payload(self, populated_case):
        # Behavior pin: missing table -> empty columns/rows, not an exception.
        case_id, _rid, _rdir, rel = populated_case
        data = await db_viewer_manager.get_table_data(
            case_id, rel, "does_not_exist", page=0, page_size=10,
        )
        assert data.columns == []
        assert data.rows == []
        assert data.rowCount == 0


# ---------------------------------------------------------------------------
# execute_query — read-only enforcement, multi-statement rejection
# ---------------------------------------------------------------------------
class TestExecuteQuery:
    async def test_basic_select(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        result = await db_viewer_manager.execute_query(
            case_id, rel, "SELECT id, name FROM users ORDER BY id"
        )
        assert result.columns == ["id", "name"]
        assert result.rowCount == 3
        assert result.rows[0] == [1, "Alice"]
        assert isinstance(result.durationMs, int)
        assert result.durationMs >= 0

    async def test_empty_query_rejected(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        with pytest.raises(ValueError):
            await db_viewer_manager.execute_query(case_id, rel, "   ")

    async def test_multi_statement_rejected(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        with pytest.raises(ValueError):
            await db_viewer_manager.execute_query(
                case_id, rel,
                "SELECT 1; DROP TABLE users;",
            )

    async def test_insert_is_blocked_by_authorizer(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        # The authorizer denies INSERT — sqlite raises OperationalError.
        with pytest.raises(sqlite3.DatabaseError):
            await db_viewer_manager.execute_query(
                case_id, rel,
                "INSERT INTO users (id, name) VALUES (99, 'mallory')",
            )

    async def test_update_is_blocked_by_authorizer(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        with pytest.raises(sqlite3.DatabaseError):
            await db_viewer_manager.execute_query(
                case_id, rel, "UPDATE users SET name='x' WHERE id=1"
            )

    async def test_delete_is_blocked_by_authorizer(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        with pytest.raises(sqlite3.DatabaseError):
            await db_viewer_manager.execute_query(
                case_id, rel, "DELETE FROM users WHERE id=1"
            )

    async def test_drop_is_blocked_by_authorizer(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        with pytest.raises(sqlite3.DatabaseError):
            await db_viewer_manager.execute_query(
                case_id, rel, "DROP TABLE users"
            )

    async def test_pragma_write_is_blocked(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        # `journal_mode` is not in ALLOWED_PRAGMAS.
        with pytest.raises(sqlite3.DatabaseError):
            await db_viewer_manager.execute_query(
                case_id, rel, "PRAGMA journal_mode=DELETE"
            )

    async def test_pragma_read_is_allowed(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        result = await db_viewer_manager.execute_query(
            case_id, rel, "PRAGMA table_info('users')"
        )
        # PRAGMA returns rows; columns include the standard pragma columns
        names = {r[1] for r in result.rows}
        assert names == {"id", "name", "email"}

    async def test_read_only_db_rejects_writes_when_state_unchanged(self, populated_case):
        """After blocked writes, the underlying file is unmodified."""
        case_id, _rid, _rdir, rel = populated_case
        try:
            await db_viewer_manager.execute_query(
                case_id, rel, "DELETE FROM users"
            )
        except sqlite3.DatabaseError:
            pass

        result = await db_viewer_manager.execute_query(
            case_id, rel, "SELECT COUNT(*) FROM users"
        )
        assert result.rows[0][0] == 3


# ---------------------------------------------------------------------------
# Path traversal protection
# ---------------------------------------------------------------------------
class TestPathTraversal:
    async def test_dotdot_in_relative_path_rejected(self, populated_case, tmp_data_dir, make_sample_db):
        """A relative path containing .. must not escape the report dir."""
        case_id, report_id, report_dir, _rel = populated_case

        # Create a file *outside* the report directory we'll try to reach.
        outside = tmp_data_dir / "reports" / "outside.db"
        make_sample_db(outside)

        # The resolved path Path(report_dir) / "../outside.db" actually exists,
        # so `_resolve_db_path` should raise ValueError via the
        # `.relative_to(...)` check.
        bad_rel = f"{report_id}/../outside.db"
        with pytest.raises(ValueError):
            await db_viewer_manager.get_database_schema(case_id, bad_rel)

    async def test_unknown_report_id_rejected(self, populated_case):
        case_id, *_ = populated_case
        with pytest.raises(ValueError):
            await db_viewer_manager.get_database_schema(case_id, "999999/foo.db")


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
class TestExport:
    async def test_export_csv(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        csv_text = await db_viewer_manager.export_query(
            case_id, rel,
            "SELECT id, name FROM users ORDER BY id",
            format_type="csv",
        )
        # header + 3 data rows
        lines = [ln for ln in csv_text.splitlines() if ln]
        assert lines[0] == "id,name"
        assert "Alice" in lines[1]
        assert len(lines) == 4

    async def test_export_json(self, populated_case):
        case_id, _rid, _rdir, rel = populated_case
        body = await db_viewer_manager.export_query(
            case_id, rel,
            "SELECT id, name FROM users ORDER BY id",
            format_type="json",
        )
        parsed = json.loads(body)
        assert parsed == [
            {"id": 1, "name": "Alice"},
            {"id": 2, "name": "Bob"},
            {"id": 3, "name": "Carol"},
        ]
