"""Tests for services.spatial_manager.SpatialManager.

Real filesystem under tmp_data_dir; no external HTTP calls (this manager has no
external geocoding — that lives in tile_manager — so we just exercise local IO).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


# Sample KML content for tests
_MINIMAL_KML = """<?xml version="1.0" encoding="utf-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>row-1</name>
      <Point><coordinates>-122.42,37.77,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>
"""

_MATCHING_TSV = "Timestamp\tLatitude\tLongitude\nrow-1\t37.77\t-122.42\n"


def _make_report_kml(reports_dir: Path, tool: str = "ileapp", case: str = "case-x",
                     report: str = "ReportA") -> Path:
    """Create a KML file under REPORTS_DIR/<tool>-reports/<case>/<report>/_KML Exports/."""
    kml_dir = reports_dir / f"{tool}-reports" / case / report / "_KML Exports"
    kml_dir.mkdir(parents=True, exist_ok=True)
    kml_path = kml_dir / "Locations Location Data.kml"
    kml_path.write_text(_MINIMAL_KML)
    return kml_path


# ---------------------------------------------------------------------------
# get_kml_files: grouping & deletable flag
# ---------------------------------------------------------------------------
async def test_get_kml_files_groups_reports_and_imports(fresh_db, tmp_data_dir, monkeypatch):
    from services import spatial_manager as sm_mod

    reports_dir = tmp_data_dir / "reports"
    imports_dir = Path(sm_mod.IMPORTS_DIR)
    imports_dir.mkdir(parents=True, exist_ok=True)

    # Plant a report KML
    _make_report_kml(reports_dir, case="case-x", report="ReportA")

    # Plant an imported KML
    imp = imports_dir / "user-upload.kml"
    imp.write_text(_MINIMAL_KML)

    result = await sm_mod.spatial_manager.get_kml_files()

    assert "Imported Files" in result
    uploaded = result["Imported Files"]
    assert any(f["name"] == "user-upload.kml" and f["is_deletable"] for f in uploaded)

    # At least one report group exists (key derived from case folder or DB)
    report_groups = [k for k in result.keys() if k != "Imported Files"]
    assert report_groups, f"Expected a report group, got: {list(result.keys())}"
    report_entries = result[report_groups[0]]
    assert all(not f["is_deletable"] for f in report_entries)
    assert any(f["name"].endswith(".kml") for f in report_entries)

    # Cleanup
    imp.unlink()


async def test_get_kml_files_uses_db_report_name_when_present(fresh_db, tmp_data_dir):
    from core.database import db_execute
    from services.spatial_manager import spatial_manager

    reports_dir = tmp_data_dir / "reports"
    kml_path = _make_report_kml(reports_dir, case="case-x", report="ReportB")
    report_dir = kml_path.parent.parent  # the ReportB dir

    # Register the report in DB so its DB-given name is used as the group key
    await db_execute(
        "INSERT INTO reports (name, path, tool) VALUES (?, ?, ?)",
        ("Pretty Report Name", str(report_dir), "ileapp"),
    )

    result = await spatial_manager.get_kml_files()
    assert "Pretty Report Name" in result


async def test_get_kml_files_case_filter_excludes_other_cases(fresh_db, tmp_data_dir):
    from core.database import db_execute_return_id, db_execute
    from services.spatial_manager import spatial_manager

    reports_dir = tmp_data_dir / "reports"
    kml1 = _make_report_kml(reports_dir, case="case-1", report="R1")
    kml2 = _make_report_kml(reports_dir, case="case-2", report="R2")

    # Register only R1 against a case
    case_id = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("MyCase", "Active", "Medium"),
    )
    await db_execute(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("R1", str(kml1.parent.parent), "ileapp", case_id),
    )

    result = await spatial_manager.get_kml_files(case_id=case_id)
    # Only R1's group should appear (R2 not in DB for this case)
    report_keys = [k for k in result.keys() if k != "Imported Files"]
    assert "R1" in report_keys
    assert "R2" not in report_keys


# ---------------------------------------------------------------------------
# save / delete imported files
# ---------------------------------------------------------------------------
async def test_save_imported_file_writes_to_imports(tmp_data_dir):
    from services.spatial_manager import IMPORTS_DIR, spatial_manager

    saved = await spatial_manager.save_imported_file(b"<kml/>", "uploaded.kml")
    expected = Path(IMPORTS_DIR) / "uploaded.kml"
    assert saved == "uploaded.kml"
    assert expected.exists()
    expected.unlink()  # cleanup


async def test_save_imported_file_sanitizes_path_traversal(tmp_data_dir):
    """The basename guard must defeat ../ traversal attempts."""
    from services.spatial_manager import IMPORTS_DIR, spatial_manager

    saved = await spatial_manager.save_imported_file(b"<kml/>", "../../../../etc/passwd.kml")
    expected = Path(IMPORTS_DIR) / "passwd.kml"
    assert saved == "passwd.kml"
    assert expected.exists()
    expected.unlink()


async def test_save_imported_file_size_limit_rejected(tmp_data_dir):
    from services.spatial_manager import MAX_SPATIAL_FILE_BYTES, spatial_manager

    too_big = b"x" * (MAX_SPATIAL_FILE_BYTES + 1)
    with pytest.raises(ValueError, match="25 MB"):
        await spatial_manager.save_imported_file(too_big, "huge.kml")


async def test_delete_imported_file_only_deletes_inside_imports(tmp_data_dir):
    from services.spatial_manager import IMPORTS_DIR, spatial_manager

    f = Path(IMPORTS_DIR) / "to-delete.kml"
    f.write_text("<kml/>")
    assert f.exists()
    deleted = await spatial_manager.delete_imported_file("to-delete.kml")
    assert deleted is True
    assert not f.exists()


async def test_delete_imported_file_missing_returns_false(tmp_data_dir):
    from services.spatial_manager import spatial_manager
    assert await spatial_manager.delete_imported_file("does-not-exist.kml") is False


async def test_delete_imported_file_traversal_is_neutered(tmp_data_dir):
    """A traversal-style filename should resolve to a basename inside IMPORTS_DIR,
    never touch files outside it."""
    from services.spatial_manager import spatial_manager

    # Drop a sentinel OUTSIDE imports — it must survive any delete attempt.
    sentinel = Path(tmp_data_dir) / "do-not-delete.kml"
    sentinel.write_text("safe")

    result = await spatial_manager.delete_imported_file("../do-not-delete.kml")
    # basename() reduces it to "do-not-delete.kml" which isn't in IMPORTS_DIR -> False
    assert result is False
    assert sentinel.exists(), "Traversal delete must not escape IMPORTS_DIR"
    sentinel.unlink()


# ---------------------------------------------------------------------------
# get_kml_data: read + enrich + traversal rejection
# ---------------------------------------------------------------------------
async def test_get_kml_data_returns_bytes_for_valid_report(fresh_db, tmp_data_dir):
    from services.spatial_manager import spatial_manager

    reports_dir = tmp_data_dir / "reports"
    kml_path = _make_report_kml(reports_dir, case="case-z", report="ReportZ")

    # The URL-style path used by the API (relative to /reports/)
    rel = "/reports/" + str(kml_path.relative_to(reports_dir))
    data = await spatial_manager.get_kml_data(rel)
    assert isinstance(data, bytes)
    assert b"Placemark" in data


async def test_get_kml_data_traversal_rejected(fresh_db, tmp_data_dir):
    from services.spatial_manager import spatial_manager

    # Attempt to read /etc/passwd via traversal — must be rejected.
    with pytest.raises((PermissionError, FileNotFoundError)):
        await spatial_manager.get_kml_data("/reports/../../../etc/passwd")


async def test_get_kml_data_missing_file_raises(fresh_db, tmp_data_dir):
    from services.spatial_manager import spatial_manager

    with pytest.raises(FileNotFoundError):
        await spatial_manager.get_kml_data("/reports/no-such-file.kml")


async def test_get_kml_abs_path_imports_prefix(tmp_data_dir):
    from services.spatial_manager import IMPORTS_DIR, spatial_manager

    p = spatial_manager.get_kml_abs_path("/imports/foo.kml")
    assert p == os.path.join(IMPORTS_DIR, "foo.kml")


async def test_get_kml_abs_path_reports_prefix(tmp_data_dir):
    from core.config import REPORTS_DIR
    from services.spatial_manager import spatial_manager

    p = spatial_manager.get_kml_abs_path("/reports/sub/foo.kml")
    assert p == os.path.join(REPORTS_DIR, "sub/foo.kml")


# ---------------------------------------------------------------------------
# Geocoding: spatial_manager itself does no HTTP — sanity assert that boundary
# ---------------------------------------------------------------------------
def test_spatial_manager_has_no_geocoding_attr():
    """Document the contract: geocoding lives in tile_manager, not spatial_manager."""
    from services.spatial_manager import spatial_manager
    assert not hasattr(spatial_manager, "geocode")
    assert not hasattr(spatial_manager, "search_location")
