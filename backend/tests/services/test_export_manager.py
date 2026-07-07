"""Tests for services.export_manager.ExportManager.

Uses the real SQLite database via fresh_db. Filesystem operations stay inside
tmp_data_dir so we can drive the full pending → processing → completed path.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest


async def _insert_case(name: str = "ExportCase") -> int:
    from services.case_manager import case_manager
    return await case_manager.create_case({
        "name": name,
        "case_number": "C-EXP",
        "client_name": "x",
        "client_phone": "+1-555-0123",
        "client_email": "x@example.com",
        "description": "d",
        "status": "Active",
        "priority": "Medium",
    })


# ---------------------------------------------------------------------------
# sanitize_filename
# ---------------------------------------------------------------------------
def test_sanitize_filename_strips_path_chars():
    from services.export_manager import sanitize_filename
    assert sanitize_filename('a/b\\c<d>e:f"g|h?i*j') == "a_b_c_d_e_f_g_h_i_j"


def test_sanitize_filename_falls_back_to_export_when_empty():
    from services.export_manager import sanitize_filename
    assert sanitize_filename("") == "export"
    assert sanitize_filename("....") == "export"


def test_sanitize_filename_truncates_long():
    from services.export_manager import sanitize_filename
    out = sanitize_filename("x" * 250)
    assert len(out) <= 100


# ---------------------------------------------------------------------------
# create_export_job
# ---------------------------------------------------------------------------
async def test_create_export_job_inserts_pending_row(fresh_db):
    from core.database import db_fetch_one
    from core.state import export_tasks
    from services.export_manager import export_manager

    case_id = await _insert_case()
    res = await export_manager.create_export_job(case_id)
    job_id = res["job_id"]

    row = await db_fetch_one("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
    assert row is not None
    assert row["status"] == "pending"
    assert row["case_id"] == case_id
    assert row["file_path"] is None

    # Queue initialized for SSE streaming
    assert job_id in export_tasks
    assert export_tasks[job_id]["status"] == "pending"


async def test_create_export_job_missing_case_raises(fresh_db):
    from services.export_manager import export_manager
    with pytest.raises(ValueError, match="Case not found"):
        await export_manager.create_export_job(424242)


async def test_create_export_job_blocks_concurrent_active(fresh_db):
    from services.export_manager import export_manager
    case_id = await _insert_case()
    await export_manager.create_export_job(case_id)
    with pytest.raises(ValueError, match="already in progress"):
        await export_manager.create_export_job(case_id)


# ---------------------------------------------------------------------------
# get_export_job
# ---------------------------------------------------------------------------
async def test_get_export_job_returns_row(fresh_db):
    from services.export_manager import export_manager
    case_id = await _insert_case()
    res = await export_manager.create_export_job(case_id)
    row = await export_manager.get_export_job(res["job_id"])
    assert row["id"] == res["job_id"]


async def test_get_export_job_missing_returns_none(fresh_db):
    from services.export_manager import export_manager
    assert await export_manager.get_export_job(99999) is None


# ---------------------------------------------------------------------------
# Full processing path: pending → processing → completed (real archive)
# ---------------------------------------------------------------------------
async def test_full_export_pipeline_creates_zip(fresh_db, tmp_data_dir):
    """End-to-end: seed a report + backup on disk, run start_export_processing,
    and confirm the job ends in 'completed' with file_path set to an existing zip."""
    from core.database import db_execute, db_fetch_one
    from services.export_manager import export_manager

    case_id = await _insert_case("Export-IT")

    # Seed a report on disk
    report_dir = Path(tmp_data_dir) / "reports" / "ileapp" / "case-exp" / "Report1"
    report_dir.mkdir(parents=True, exist_ok=True)
    (report_dir / "index.html").write_text("<html>report</html>")
    await db_execute(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("Report1", str(report_dir), "ileapp", case_id),
    )

    # Seed a completed backup on disk
    backup_dir = Path(tmp_data_dir) / "backups" / "bk1"
    backup_dir.mkdir(parents=True, exist_ok=True)
    (backup_dir / "manifest.plist").write_text("backup")
    await db_execute(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("BK1", "udid-1", "dev", str(backup_dir), "completed", case_id),
    )

    res = await export_manager.create_export_job(case_id)
    job_id = res["job_id"]

    await export_manager.start_export_processing(job_id)

    # Wait briefly for the background task to complete (it's local IO)
    for _ in range(50):
        row = await db_fetch_one("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
        if row["status"] in ("completed", "failed"):
            break
        await asyncio.sleep(0.1)

    row = await db_fetch_one("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
    assert row["status"] == "completed", f"expected completed, got {row['status']}"
    assert row["file_path"] is not None
    assert os.path.exists(row["file_path"]), "ZIP file should exist on completion"
    assert row["file_path"].endswith(".zip")
    assert row["completed_at"] is not None

    # Clean up the zip & temp dir
    try:
        from shutil import rmtree
        rmtree(os.path.dirname(row["file_path"]), ignore_errors=True)
    except Exception:
        pass


async def test_start_export_processing_no_assets_marks_failed(fresh_db):
    """No reports or completed backups → job transitions to 'failed'."""
    from core.database import db_fetch_one
    from services.export_manager import export_manager

    case_id = await _insert_case("Empty Case")
    res = await export_manager.create_export_job(case_id)
    job_id = res["job_id"]

    await export_manager.start_export_processing(job_id)

    for _ in range(50):
        row = await db_fetch_one("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
        if row["status"] in ("completed", "failed"):
            break
        await asyncio.sleep(0.1)

    row = await db_fetch_one("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
    assert row["status"] == "failed"


async def test_start_export_processing_rejects_non_pending(fresh_db):
    from core.database import db_execute
    from services.export_manager import export_manager

    case_id = await _insert_case()
    res = await export_manager.create_export_job(case_id)
    job_id = res["job_id"]

    # Manually flip status to processing
    await db_execute("UPDATE export_jobs SET status = ? WHERE id = ?", ("processing", job_id))

    with pytest.raises(ValueError, match="not in pending"):
        await export_manager.start_export_processing(job_id)


# ---------------------------------------------------------------------------
# Status reporting
# ---------------------------------------------------------------------------
async def test_get_job_status_falls_back_to_db(fresh_db):
    from services.export_manager import export_manager

    case_id = await _insert_case()
    res = await export_manager.create_export_job(case_id)
    job_id = res["job_id"]
    # Clear in-memory cache so we exercise the DB path
    export_manager.active_exports.pop(job_id, None)

    s = await export_manager.get_job_status(job_id)
    assert s["status"] == "pending"


async def test_get_job_status_missing_raises(fresh_db):
    from services.export_manager import export_manager
    with pytest.raises(ValueError, match="not found"):
        await export_manager.get_job_status(98765)


async def test_get_job_status_completed_with_missing_file_marks_failed(fresh_db):
    """If DB says completed but the zip is gone, status flips to failed/expired."""
    from core.database import db_execute, db_execute_return_id
    from services.export_manager import export_manager

    case_id = await _insert_case()
    job_id = await db_execute_return_id(
        "INSERT INTO export_jobs (case_id, status, file_path) VALUES (?, ?, ?)",
        (case_id, "completed", "/tmp/this-file-does-not-exist.zip"),
    )
    export_manager.active_exports.pop(job_id, None)

    s = await export_manager.get_job_status(job_id)
    assert s["status"] == "failed"
    assert "expired" in s["error"].lower()


# ---------------------------------------------------------------------------
# delete_export_job
# ---------------------------------------------------------------------------
async def test_delete_export_job_removes_row(fresh_db):
    from core.database import db_fetch_one
    from services.export_manager import export_manager

    case_id = await _insert_case()
    res = await export_manager.create_export_job(case_id)
    job_id = res["job_id"]

    await export_manager.delete_export_job(job_id)
    assert await db_fetch_one("SELECT id FROM export_jobs WHERE id = ?", (job_id,)) is None


async def test_delete_export_job_missing_raises(fresh_db):
    from services.export_manager import export_manager
    with pytest.raises(ValueError, match="not found"):
        await export_manager.delete_export_job(424242)
