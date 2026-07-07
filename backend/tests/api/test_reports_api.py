"""Tests for api/reports.py."""

from __future__ import annotations

from pathlib import Path

import pytest


def _make_report_dir(reports_root: Path, name: str, num_files: int = 2) -> Path:
    d = reports_root / name
    d.mkdir(parents=True, exist_ok=True)
    for i in range(num_files):
        (d / f"f{i}.html").write_text(f"<html><body>file {i}</body></html>")
    return d


async def _insert_report(case_id: int, name: str, path: str, tool: str = "ileapp") -> int:
    from core.database import db_execute_return_id
    return await db_execute_return_id(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        (name, path, tool, case_id),
    )


@pytest.fixture
async def case_id(sample_case) -> int:
    return sample_case["id"]


@pytest.fixture
def reports_root(tmp_data_dir) -> Path:
    return tmp_data_dir / "reports"


# GET /api/reports

async def test_list_reports_empty_without_case_id(client, fresh_db):
    resp = await client.get("/api/reports")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_reports_returns_serialized_rows(client, case_id, reports_root):
    rdir = _make_report_dir(reports_root, "rep1", num_files=3)
    report_id = await _insert_report(case_id, "Rep1", str(rdir))

    resp = await client.get(f"/api/reports?case_id={case_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    item = body[0]
    assert item["id"] == report_id
    assert item["name"] == "Rep1"
    assert item["tool"] == "ileapp"
    assert item["url"] == f"/api/reports/{report_id}/view/index.html"
    assert item["artifact_count"] == 3
    assert isinstance(item["size"], str)


# DELETE /api/reports/{id}

async def test_delete_report_success(client, case_id, reports_root):
    from core.database import db_fetch_one

    rdir = _make_report_dir(reports_root, "to_kill")
    report_id = await _insert_report(case_id, "ToKill", str(rdir))

    resp = await client.delete(f"/api/reports/{report_id}")
    assert resp.status_code == 200
    assert "deleted" in resp.json()["message"].lower()
    assert not rdir.exists()
    assert await db_fetch_one("SELECT id FROM reports WHERE id = ?", (report_id,)) is None


async def test_delete_report_404(client, fresh_db):
    resp = await client.delete("/api/reports/999999")
    assert resp.status_code == 404


async def test_delete_report_outside_dir_403(client, case_id, tmp_data_dir):
    rogue = tmp_data_dir / "data" / "rogue_api"
    rogue.mkdir(parents=True, exist_ok=True)
    (rogue / "x.html").write_text("x")
    report_id = await _insert_report(case_id, "Rogue", str(rogue))

    resp = await client.delete(f"/api/reports/{report_id}")
    assert resp.status_code == 403


# POST /api/reports/{id}/open and /open-log error paths

async def test_open_report_404(client, fresh_db):
    resp = await client.post("/api/reports/123456/open")
    assert resp.status_code == 404


async def test_open_report_log_404_when_log_missing(client, case_id, reports_root):
    rdir = _make_report_dir(reports_root, "no_log")  # no processing.log inside
    report_id = await _insert_report(case_id, "NoLog", str(rdir))

    resp = await client.post(f"/api/reports/{report_id}/open-log")
    assert resp.status_code == 404


async def test_open_report_log_for_missing_report_404(client, fresh_db):
    resp = await client.post("/api/reports/424242/open-log")
    assert resp.status_code == 404


# GET /api/reports/{id}/view/{file_path}

async def test_serve_report_html_injects_and_returns_200(client, case_id, reports_root):
    rdir = _make_report_dir(reports_root, "viewable", num_files=1)
    report_id = await _insert_report(case_id, "Viewable", str(rdir))

    resp = await client.get(f"/api/reports/{report_id}/view/f0.html")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    # Body should still contain the original marker.
    assert "file 0" in resp.text


async def test_serve_report_traversal_blocked(client, case_id, reports_root):
    rdir = _make_report_dir(reports_root, "secured")
    report_id = await _insert_report(case_id, "Secured", str(rdir))

    resp = await client.get(f"/api/reports/{report_id}/view/../../etc/passwd")
    # Either 403 (denied) or 404 depending on how the path resolves; both
    # mean the file was not served. We assert it's not 200.
    assert resp.status_code in (403, 404)


async def test_serve_report_missing_file_404(client, case_id, reports_root):
    rdir = _make_report_dir(reports_root, "served")
    report_id = await _insert_report(case_id, "Served", str(rdir))

    resp = await client.get(f"/api/reports/{report_id}/view/nope.html")
    assert resp.status_code == 404


async def test_serve_report_unknown_id_404(client, fresh_db):
    resp = await client.get("/api/reports/77777/view/index.html")
    assert resp.status_code == 404


# GET /api/reports/{id}/download

async def test_download_report_returns_zip(client, case_id, reports_root):
    rdir = _make_report_dir(reports_root, "downloadable", num_files=2)
    report_id = await _insert_report(case_id, "DL", str(rdir))

    resp = await client.get(f"/api/reports/{report_id}/download")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert resp.content[:2] == b"PK"  # zip magic


async def test_download_report_404(client, fresh_db):
    resp = await client.get("/api/reports/123/download")
    assert resp.status_code == 404
