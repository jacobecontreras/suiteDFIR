"""Tests for services.case_manager.CaseManager.

Uses the real SQLite database via the `fresh_db` fixture and real filesystem
operations rooted at the session tmp dir (see tests/conftest.py).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# create / get
# ---------------------------------------------------------------------------
async def test_create_case_returns_int_id(fresh_db):
    from services.case_manager import case_manager

    case_id = await case_manager.create_case({
        "name": "Op Phoenix",
        "case_number": "CN-100",
        "client_name": "Alice",
        "client_phone": "+1-555-0000",
        "client_email": "alice@example.com",
        "description": "desc",
        "status": "Active",
        "priority": "High",
    })
    assert isinstance(case_id, int) and case_id > 0


async def test_get_case_returns_row(sample_case):
    from services.case_manager import case_manager

    row = await case_manager.get_case(sample_case["id"])
    assert row["id"] == sample_case["id"]
    assert row["name"] == "Sample Case"
    assert row["client_email"] == "acme@example.com"


async def test_get_case_missing_raises_value_error(fresh_db):
    from services.case_manager import case_manager

    with pytest.raises(ValueError, match="not found"):
        await case_manager.get_case(99999)


# ---------------------------------------------------------------------------
# update
# ---------------------------------------------------------------------------
async def test_update_case_valid_columns(sample_case):
    from services.case_manager import case_manager

    ok = await case_manager.update_case(sample_case["id"], {
        "name": "Renamed",
        "status": "Closed",
    })
    assert ok is True
    row = await case_manager.get_case(sample_case["id"])
    assert row["name"] == "Renamed"
    assert row["status"] == "Closed"


async def test_update_case_empty_data_returns_false(sample_case):
    from services.case_manager import case_manager

    result = await case_manager.update_case(sample_case["id"], {})
    assert result is False


async def test_update_case_rejects_invalid_columns(sample_case):
    """SQL-injection guard: only whitelisted column names allowed."""
    from services.case_manager import case_manager

    with pytest.raises(ValueError, match="Invalid column names"):
        await case_manager.update_case(sample_case["id"], {
            "name": "ok",
            "evil_col; DROP TABLE cases; --": "x",
        })


async def test_update_case_missing_raises_value_error(fresh_db):
    from services.case_manager import case_manager

    with pytest.raises(ValueError, match="not found"):
        await case_manager.update_case(424242, {"name": "x"})


# ---------------------------------------------------------------------------
# visit
# ---------------------------------------------------------------------------
async def test_visit_case_sets_last_visited_at(sample_case):
    from services.case_manager import case_manager

    assert sample_case["last_visited_at"] is None
    await case_manager.visit_case(sample_case["id"])
    row = await case_manager.get_case(sample_case["id"])
    assert row["last_visited_at"] is not None


async def test_visit_case_missing_raises_value_error(fresh_db):
    from services.case_manager import case_manager

    with pytest.raises(ValueError, match="not found"):
        await case_manager.visit_case(91919)


# ---------------------------------------------------------------------------
# delete: cascade + filesystem cleanup
# ---------------------------------------------------------------------------
async def test_delete_case_cascades_db_rows(sample_case):
    from core.database import db_execute, db_fetch_all, db_fetch_one
    from services.case_manager import case_manager

    cid = sample_case["id"]

    # Seed dependent rows directly so we don't rely on other managers.
    await db_execute(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("b1", "udid-1", "dev", "/tmp/nope-backup", "completed", cid),
    )
    await db_execute(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("r1", "/tmp/nope-report", "ileapp", cid),
    )
    await db_execute(
        "INSERT INTO tasks (content, case_id) VALUES (?, ?)",
        ("do thing", cid),
    )
    await db_execute(
        "INSERT INTO notes (content, case_id) VALUES (?, ?)",
        ("notable", cid),
    )

    result = await case_manager.delete_case(cid)
    assert result["success"] is True

    assert await db_fetch_one("SELECT * FROM cases WHERE id = ?", (cid,)) is None
    assert await db_fetch_all("SELECT * FROM backups WHERE case_id = ?", (cid,)) == []
    assert await db_fetch_all("SELECT * FROM reports WHERE case_id = ?", (cid,)) == []
    assert await db_fetch_all("SELECT * FROM tasks WHERE case_id = ?", (cid,)) == []
    assert await db_fetch_all("SELECT * FROM notes WHERE case_id = ?", (cid,)) == []


async def test_delete_case_missing_raises(fresh_db):
    from services.case_manager import case_manager

    with pytest.raises(ValueError, match="not found"):
        await case_manager.delete_case(12345)


async def test_delete_case_removes_files_and_empty_parent(sample_case, tmp_data_dir):
    """Real files on disk should be removed and now-empty case dirs swept."""
    from core.database import db_execute
    from services.case_manager import case_manager

    cid = sample_case["id"]

    reports_dir = tmp_data_dir / "reports"
    backups_dir = tmp_data_dir / "backups"

    # backup file (under BACKUPS_DIR/<name>)
    backup_path = backups_dir / f"backup-{cid}"
    backup_path.mkdir(parents=True, exist_ok=True)
    (backup_path / "manifest.plist").write_text("backup payload")

    # report dir (under REPORTS_DIR/<tool>/<case>/<report-instance>)
    case_dir = reports_dir / "ileapp" / "case-folder"
    report_path = case_dir / "iLEAPP_Report_001"
    report_path.mkdir(parents=True, exist_ok=True)
    (report_path / "index.html").write_text("report payload")

    await db_execute(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("b1", "udid", "dev", str(backup_path), "completed", cid),
    )
    await db_execute(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("r1", str(report_path), "ileapp", cid),
    )

    await case_manager.delete_case(cid)

    assert not backup_path.exists(), "backup dir should be deleted"
    assert not report_path.exists(), "report dir should be deleted"
    # Empty case-folder parent should be swept; ileapp tool dir stays (direct child of root)
    assert not case_dir.exists(), "empty case parent dir should be cleaned up"


# ---------------------------------------------------------------------------
# cleanup_orphaned_files
# ---------------------------------------------------------------------------
async def test_cleanup_orphaned_files_removes_unknown_folders(fresh_db, tmp_data_dir):
    from services.case_manager import case_manager
    from core.database import db_execute

    backups_dir = tmp_data_dir / "backups"
    reports_dir = tmp_data_dir / "reports"

    # Orphan: not present in DB at all
    orphan_backup = backups_dir / "ghost-backup"
    orphan_backup.mkdir(parents=True, exist_ok=True)
    (orphan_backup / "junk.txt").write_text("x")

    # Known: present in DB, must survive
    known_backup = backups_dir / "real-backup"
    known_backup.mkdir(parents=True, exist_ok=True)
    (known_backup / "manifest.plist").write_text("x")
    await db_execute(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("real", "udid", "dev", str(known_backup), "completed", None),
    )

    # Reports: nested REPORTS_DIR/<tool>/<case>/<instance>
    orphan_report = reports_dir / "ileapp" / "case-x" / "Ghost_Report"
    orphan_report.mkdir(parents=True, exist_ok=True)
    (orphan_report / "stale.html").write_text("x")

    known_report = reports_dir / "ileapp" / "case-x" / "Real_Report"
    known_report.mkdir(parents=True, exist_ok=True)
    (known_report / "index.html").write_text("x")
    await db_execute(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("real", str(known_report), "ileapp", None),
    )

    await case_manager.cleanup_orphaned_files()

    assert not orphan_backup.exists()
    assert known_backup.exists()
    assert not orphan_report.exists()
    assert known_report.exists()
