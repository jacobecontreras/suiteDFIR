"""Tests for services/system_manager.py.

psutil and platform-specific subprocess calls are mocked. Real DB + FS are
used for storage breakdown and recent activity queries.
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def patch_psutil(monkeypatch):
    """Deterministic psutil values so tests are platform-independent."""
    from services import system_manager as sm

    fake_vm = SimpleNamespace(percent=42.5)
    fake_disk = SimpleNamespace(total=1_000_000_000, free=600_000_000, used=400_000_000, percent=40.0)

    monkeypatch.setattr(sm.psutil, "cpu_percent", lambda interval=1: 12.5)
    monkeypatch.setattr(sm.psutil, "virtual_memory", lambda: fake_vm)
    monkeypatch.setattr(sm.psutil, "disk_usage", lambda path: fake_disk)
    return {"cpu": 12.5, "ram": 42.5, "disk": 40.0,
            "total": 1_000_000_000, "free": 600_000_000, "used": 400_000_000}


async def _make_dir_with_bytes(path: Path, payload: bytes) -> int:
    path.mkdir(parents=True, exist_ok=True)
    f = path / "file.bin"
    f.write_bytes(payload)
    return len(payload)


# get_root_info & get_health_check

async def test_get_root_info_reports_known_tools(fresh_db):
    from services.system_manager import system_manager

    info = await system_manager.get_root_info()
    assert "message" in info
    assert set(info["tools"]) >= {"ileapp", "aleapp"}
    assert isinstance(info["modules_loaded"], int)


async def test_get_health_check_lists_all_tools(fresh_db):
    from services.system_manager import system_manager

    health = await system_manager.get_health_check()
    assert health["status"] == "healthy"
    assert set(health["tools_initialized"].keys()) == {"ileapp", "aleapp"}
    # All entries are booleans.
    for v in health["tools_initialized"].values():
        assert isinstance(v, bool)


# get_health_metrics

async def test_get_health_metrics_returns_mocked_values(patch_psutil, fresh_db):
    from services.system_manager import system_manager

    metrics = await system_manager.get_health_metrics()
    assert metrics == {"cpu": 12.5, "ram": 42.5, "disk": 40.0}


# get_storage_usage

async def test_get_storage_usage_breakdown_unscoped(patch_psutil, fresh_db, tmp_data_dir):
    from core.database import db_execute_return_id
    from services.system_manager import system_manager

    backup_dir = tmp_data_dir / "backups" / "b1"
    report_dir = tmp_data_dir / "reports" / "r1"
    backup_bytes = await _make_dir_with_bytes(backup_dir, b"x" * 1024)
    report_bytes = await _make_dir_with_bytes(report_dir, b"y" * 2048)

    # Insert a case so the FK is consistent.
    case_id = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("c", "Active", "Medium"),
    )

    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("Bk", "u", "Phone", str(backup_dir), "completed", case_id, "ios"),
    )
    await db_execute_return_id(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("Rep", str(report_dir), "ileapp", case_id),
    )

    usage = await system_manager.get_storage_usage()
    assert usage["total"] == patch_psutil["total"]
    assert usage["free"] == patch_psutil["free"]

    by_name = {item["name"]: item for item in usage["breakdown"]}
    assert by_name["Backups"]["value"] == backup_bytes
    assert by_name["Reports"]["value"] == report_bytes
    assert by_name["Free"]["value"] == patch_psutil["free"]
    # System = used - backups - reports, never negative.
    expected_system = max(0, patch_psutil["used"] - backup_bytes - report_bytes)
    assert by_name["System"]["value"] == expected_system


async def test_get_storage_usage_scoped_to_case(patch_psutil, fresh_db, tmp_data_dir):
    from core.database import db_execute_return_id
    from services.system_manager import system_manager

    case_a = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("A", "Active", "Medium"),
    )
    case_b = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("B", "Active", "Medium"),
    )

    dir_a = tmp_data_dir / "backups" / "case_a"
    dir_b = tmp_data_dir / "backups" / "case_b"
    a_bytes = await _make_dir_with_bytes(dir_a, b"a" * 500)
    await _make_dir_with_bytes(dir_b, b"b" * 9000)

    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("Ba", "u", "P", str(dir_a), "completed", case_a, "ios"),
    )
    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("Bb", "u", "P", str(dir_b), "completed", case_b, "ios"),
    )

    usage = await system_manager.get_storage_usage(case_id=case_a)
    backups_item = next(i for i in usage["breakdown"] if i["name"] == "Backups")
    assert backups_item["value"] == a_bytes


async def test_get_storage_usage_skips_missing_paths(patch_psutil, fresh_db, tmp_data_dir):
    from core.database import db_execute_return_id
    from services.system_manager import system_manager

    case_id = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("c", "Active", "Medium"),
    )
    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("Ghost", "u", "P", str(tmp_data_dir / "backups" / "ghost"), "failed", case_id, "ios"),
    )

    usage = await system_manager.get_storage_usage()
    backups_item = next(i for i in usage["breakdown"] if i["name"] == "Backups")
    assert backups_item["value"] == 0


# get_recent_activity

async def test_get_recent_activity_combines_and_limits(fresh_db, tmp_data_dir):
    from core.database import db_execute_return_id
    from services.system_manager import system_manager

    case_id = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("c", "Active", "Medium"),
    )

    # 6 backups + 6 reports to verify the 5+5 LIMIT and 10-cap.
    for i in range(6):
        await db_execute_return_id(
            "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (f"B{i}", "u", "P", str(tmp_data_dir / "backups" / f"b{i}"), "completed", case_id, "ios"),
        )
    for i in range(6):
        await db_execute_return_id(
            "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
            (f"R{i}", str(tmp_data_dir / "reports" / f"r{i}"), "ileapp", case_id),
        )

    activity = await system_manager.get_recent_activity()
    assert len(activity) <= 10
    types = {a["type"] for a in activity}
    assert types == {"backup", "report"}
    # Each per-type query is LIMIT 5, so at most 5 of each appear in the combined feed.
    assert sum(1 for a in activity if a["type"] == "backup") <= 5
    assert sum(1 for a in activity if a["type"] == "report") <= 5


async def test_get_recent_activity_scoped_to_case(fresh_db, tmp_data_dir):
    from core.database import db_execute_return_id
    from services.system_manager import system_manager

    case_a = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("A", "Active", "Medium"),
    )
    case_b = await db_execute_return_id(
        "INSERT INTO cases (name, status, priority) VALUES (?, ?, ?)",
        ("B", "Active", "Medium"),
    )

    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("AOnly", "u", "P", str(tmp_data_dir / "backups" / "a"), "completed", case_a, "ios"),
    )
    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("BOnly", "u", "P", str(tmp_data_dir / "backups" / "b"), "completed", case_b, "ios"),
    )

    activity = await system_manager.get_recent_activity(case_id=case_a)
    names = {a["name"] for a in activity}
    assert "AOnly" in names
    assert "BOnly" not in names


async def test_get_recent_activity_empty(fresh_db):
    from services.system_manager import system_manager

    assert await system_manager.get_recent_activity() == []
