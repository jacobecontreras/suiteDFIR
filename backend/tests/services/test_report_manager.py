"""Tests for services/report_manager.py.

Uses the real SQLite DB (fresh_db fixture) and the real filesystem rooted at
the session tmp dir. No DB mocking — past bugs were masked by it.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


def _make_report_dir(reports_root: Path, name: str, num_files: int = 3) -> Path:
    """Create a fake report directory tree with a known number of files."""
    report_dir = reports_root / name
    report_dir.mkdir(parents=True, exist_ok=True)
    for i in range(num_files):
        f = report_dir / f"artifact_{i}.html"
        f.write_text(f"<html><body>artifact {i}</body></html>")
    sub = report_dir / "_TSV Exports"
    sub.mkdir(exist_ok=True)
    (sub / "data.tsv").write_text("col1\tcol2\nfoo\tbar\n")
    return report_dir


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


# get_reports

async def test_get_reports_returns_empty_without_case_id(fresh_db):
    from services.report_manager import report_manager

    assert await report_manager.get_reports(None) == []
    assert await report_manager.get_reports(0) == []


async def test_get_reports_computes_size_and_artifact_count(case_id, reports_root):
    from services.report_manager import report_manager

    rdir = _make_report_dir(reports_root, "report_alpha", num_files=4)
    report_id = await _insert_report(case_id, "Alpha", str(rdir))

    reports = await report_manager.get_reports(case_id)
    assert len(reports) == 1
    r = reports[0]
    assert r["id"] == report_id
    assert r["name"] == "Alpha"
    assert r["path"] == str(rdir)
    assert r["url"] == f"/api/reports/{report_id}/view/index.html"
    assert r["tool"] == "ileapp"
    # 4 html files + 1 tsv file
    assert r["artifact_count"] == 5
    # human-formatted size, e.g. "0.00KB" or similar — must be a string
    assert isinstance(r["size"], str)
    assert "B" in r["size"]


async def test_get_reports_skips_paths_missing_from_disk(case_id, reports_root):
    """Reports whose path no longer exists on disk are silently filtered."""
    from services.report_manager import report_manager

    rdir = _make_report_dir(reports_root, "exists")
    missing_path = str(reports_root / "missing_report")

    await _insert_report(case_id, "Exists", str(rdir))
    await _insert_report(case_id, "Gone", missing_path)

    reports = await report_manager.get_reports(case_id)
    names = {r["name"] for r in reports}
    assert names == {"Exists"}


async def test_get_reports_scoped_by_case(case_id, reports_root):
    """Reports for other cases must not leak."""
    from services.case_manager import case_manager
    from services.report_manager import report_manager

    other_case = await case_manager.create_case({
        "name": "Other Case",
        "status": "Active",
        "priority": "Medium",
    })

    rdir_a = _make_report_dir(reports_root, "report_for_a")
    rdir_b = _make_report_dir(reports_root, "report_for_b")

    await _insert_report(case_id, "A", str(rdir_a))
    await _insert_report(other_case, "B", str(rdir_b))

    a_reports = await report_manager.get_reports(case_id)
    b_reports = await report_manager.get_reports(other_case)

    assert {r["name"] for r in a_reports} == {"A"}
    assert {r["name"] for r in b_reports} == {"B"}


# get_report

async def test_get_report_returns_full_row(case_id, reports_root):
    from services.report_manager import report_manager

    rdir = _make_report_dir(reports_root, "single")
    report_id = await _insert_report(case_id, "Single", str(rdir))

    row = await report_manager.get_report(report_id)
    assert row is not None
    assert row["id"] == report_id
    assert row["name"] == "Single"
    assert row["path"] == str(rdir)
    assert row["tool"] == "ileapp"


async def test_get_report_missing_returns_none(fresh_db):
    from services.report_manager import report_manager

    assert await report_manager.get_report(99999) is None


# delete_report

async def test_delete_report_removes_db_row_and_files(case_id, reports_root):
    from core.database import db_fetch_one
    from services.report_manager import report_manager

    rdir = _make_report_dir(reports_root, "to_delete")
    report_id = await _insert_report(case_id, "ToDelete", str(rdir))
    assert rdir.exists()

    result = await report_manager.delete_report(report_id)
    assert "deleted" in result["message"].lower()
    assert not rdir.exists()
    assert await db_fetch_one("SELECT id FROM reports WHERE id = ?", (report_id,)) is None


async def test_delete_report_missing_raises(fresh_db):
    from services.report_manager import report_manager

    with pytest.raises(FileNotFoundError):
        await report_manager.delete_report(424242)


async def test_delete_report_outside_reports_dir_denied(case_id, tmp_data_dir):
    """A report whose path escapes REPORTS_DIR must be rejected."""
    from services.report_manager import report_manager

    # Path outside REPORTS_DIR (still inside session tmp but a sibling dir).
    rogue_dir = tmp_data_dir / "data" / "rogue_report"
    rogue_dir.mkdir(parents=True, exist_ok=True)
    (rogue_dir / "x.html").write_text("x")

    report_id = await _insert_report(case_id, "Rogue", str(rogue_dir))

    with pytest.raises(PermissionError):
        await report_manager.delete_report(report_id)

    # DB row should still exist since validation happened before delete.
    from core.database import db_fetch_one
    assert await db_fetch_one("SELECT id FROM reports WHERE id = ?", (report_id,)) is not None


async def test_delete_report_db_only_when_file_missing(case_id, reports_root):
    """If the FS path is gone but the row exists, the row is still cleared."""
    from core.database import db_fetch_one
    from services.report_manager import report_manager

    missing_path = str(reports_root / "vanished_report")
    report_id = await _insert_report(case_id, "Vanished", missing_path)

    result = await report_manager.delete_report(report_id)
    assert "deleted" in result["message"].lower()
    assert await db_fetch_one("SELECT id FROM reports WHERE id = ?", (report_id,)) is None
