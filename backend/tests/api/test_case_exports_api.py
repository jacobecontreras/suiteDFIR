"""API tests for src/api/case_exports.py."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest


async def _insert_case(name: str = "ExportApiCase") -> int:
    from services.case_manager import case_manager
    return await case_manager.create_case({
        "name": name,
        "case_number": "C-EXP-API",
        "client_name": "x",
        "client_phone": "+1-555-0123",
        "client_email": "x@example.com",
        "description": "d",
        "status": "Active",
        "priority": "Medium",
    })


# ---------------------------------------------------------------------------
# POST /api/cases/{id}/export
# ---------------------------------------------------------------------------
async def test_create_export_returns_job_id(client, fresh_db):
    case_id = await _insert_case()
    resp = await client.post(f"/api/cases/{case_id}/export")
    assert resp.status_code == 200
    body = resp.json()
    assert "job_id" in body
    assert isinstance(body["job_id"], int)
    assert body["message"] == "Export job created"


async def test_create_export_missing_case_404(client, fresh_db):
    resp = await client.post("/api/cases/99999/export")
    assert resp.status_code == 404


async def test_create_export_409_when_active_exists(client, fresh_db):
    case_id = await _insert_case()
    r1 = await client.post(f"/api/cases/{case_id}/export")
    assert r1.status_code == 200
    r2 = await client.post(f"/api/cases/{case_id}/export")
    assert r2.status_code == 409
    assert "already" in r2.json()["detail"].lower()


# ---------------------------------------------------------------------------
# GET /api/cases/{id}/export/{job}/download
# ---------------------------------------------------------------------------
async def test_download_export_404_when_job_missing(client, fresh_db):
    case_id = await _insert_case()
    resp = await client.get(f"/api/cases/{case_id}/export/99999/download")
    assert resp.status_code == 404


async def test_download_export_403_wrong_case(client, fresh_db):
    from core.database import db_execute_return_id

    case_a = await _insert_case("A")
    case_b = await _insert_case("B")
    # Create a job belonging to case A
    job_id = await db_execute_return_id(
        "INSERT INTO export_jobs (case_id, status) VALUES (?, ?)",
        (case_a, "completed"),
    )
    # Try to download via case B
    resp = await client.get(f"/api/cases/{case_b}/export/{job_id}/download")
    assert resp.status_code == 403


async def test_download_export_400_when_not_completed(client, fresh_db):
    from core.database import db_execute_return_id

    case_id = await _insert_case()
    job_id = await db_execute_return_id(
        "INSERT INTO export_jobs (case_id, status) VALUES (?, ?)",
        (case_id, "pending"),
    )
    resp = await client.get(f"/api/cases/{case_id}/export/{job_id}/download")
    assert resp.status_code == 400
    assert "not completed" in resp.json()["detail"].lower()


async def test_download_export_404_when_file_missing(client, fresh_db):
    from core.database import db_execute_return_id

    case_id = await _insert_case()
    job_id = await db_execute_return_id(
        "INSERT INTO export_jobs (case_id, status, file_path) VALUES (?, ?, ?)",
        (case_id, "completed", "/tmp/no-such-export.zip"),
    )
    resp = await client.get(f"/api/cases/{case_id}/export/{job_id}/download")
    assert resp.status_code == 404


async def test_download_export_serves_zip(client, fresh_db, tmp_data_dir):
    """End-to-end: create real export, wait for completion, then download zip."""
    from core.database import db_execute, db_fetch_one
    from services.export_manager import export_manager

    case_id = await _insert_case("DLCase")

    # Seed a report on disk
    rd = Path(tmp_data_dir) / "reports" / "ileapp" / "case-dl" / "R"
    rd.mkdir(parents=True, exist_ok=True)
    (rd / "index.html").write_text("<html/>")
    await db_execute(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("R", str(rd), "ileapp", case_id),
    )

    res = await export_manager.create_export_job(case_id)
    job_id = res["job_id"]
    await export_manager.start_export_processing(job_id)

    # Wait for completion
    for _ in range(50):
        row = await db_fetch_one("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
        if row["status"] in ("completed", "failed"):
            break
        await asyncio.sleep(0.1)

    row = await db_fetch_one("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
    assert row["status"] == "completed"

    resp = await client.get(f"/api/cases/{case_id}/export/{job_id}/download")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert len(resp.content) > 0

    # Cleanup
    try:
        from shutil import rmtree
        rmtree(os.path.dirname(row["file_path"]), ignore_errors=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# GET /api/cases/{id}/export/{job}/stream  (SSE)
# ---------------------------------------------------------------------------
async def test_stream_export_status_404_when_job_missing(client, fresh_db):
    case_id = await _insert_case()
    resp = await client.get(f"/api/cases/{case_id}/export/99999/stream")
    assert resp.status_code == 404


async def test_stream_export_status_403_wrong_case(client, fresh_db):
    from core.database import db_execute_return_id

    case_a = await _insert_case("A")
    case_b = await _insert_case("B")
    job_id = await db_execute_return_id(
        "INSERT INTO export_jobs (case_id, status) VALUES (?, ?)",
        (case_a, "pending"),
    )
    resp = await client.get(f"/api/cases/{case_b}/export/{job_id}/stream")
    assert resp.status_code == 403
