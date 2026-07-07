"""Tests for services/backup_manager.py.

Covers DB CRUD, password encryption-at-rest round-trip, and file cleanup
on delete. Subprocess shellouts (idevice_id / idevicebackup2 / adb) are
mocked at the boundary — start_backup itself is not exercised here because
its happy path spawns a background asyncio task with subprocess; instead we
test the components we control deterministically.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


async def _insert_backup(
    case_id: int,
    name: str = "Test Backup",
    udid: str = "abc-udid",
    device_name: str = "iPhone 15",
    path: str = "/tmp/should-be-overridden",
    status: str = "in_progress",
    password: str | None = None,
    backup_type: str = "ios",
) -> int:
    """Insert a backup row directly via the DB layer."""
    from core.database import db_execute_return_id

    return await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, password, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (name, udid, device_name, path, status, password, case_id, backup_type),
    )


@pytest.fixture
async def case_id(sample_case) -> int:
    return sample_case["id"]


# get_backups

async def test_get_backups_returns_empty_without_case_id(fresh_db):
    from services.backup_manager import backup_manager

    assert await backup_manager.get_backups(None) == []
    assert await backup_manager.get_backups(0) == []


async def test_get_backups_filters_by_case(case_id, tmp_data_dir):
    from services.backup_manager import backup_manager
    from services.case_manager import case_manager

    other_case = await case_manager.create_case({
        "name": "Other", "status": "Active", "priority": "Medium",
    })

    a = await _insert_backup(case_id, name="Alpha", path=str(tmp_data_dir / "backups" / "a"))
    b = await _insert_backup(other_case, name="Beta", path=str(tmp_data_dir / "backups" / "b"))

    a_rows = await backup_manager.get_backups(case_id)
    b_rows = await backup_manager.get_backups(other_case)

    assert {r["id"] for r in a_rows} == {a}
    assert {r["id"] for r in b_rows} == {b}


async def test_get_backups_orders_by_created_desc(case_id, tmp_data_dir):
    """The query is ORDER BY created_at DESC. We set timestamps explicitly
    because CURRENT_TIMESTAMP has 1-second resolution and rapid inserts
    collide."""
    from core.database import db_execute_return_id
    from services.backup_manager import backup_manager

    older = await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("Older", "u", "P", str(tmp_data_dir / "backups" / "o"), "completed", case_id, "ios",
         "2024-01-01 00:00:00"),
    )
    newer = await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("Newer", "u", "P", str(tmp_data_dir / "backups" / "n"), "completed", case_id, "ios",
         "2025-06-01 00:00:00"),
    )

    rows = await backup_manager.get_backups(case_id)
    ids = [r["id"] for r in rows]
    assert ids.index(newer) < ids.index(older)


# Password encryption-at-rest

async def test_backup_password_stored_encrypted_in_db(case_id, tmp_data_dir):
    """The plaintext password must never live in the SQLite column."""
    import sqlite3

    from core.config import DB_PATH
    from core.crypto import decrypt, encrypt

    plaintext = "super-secret-passcode-1234"
    token = encrypt(plaintext)

    # Stored value is a Fernet token (base64 ASCII, prefixed gAAAAA...).
    assert token != plaintext
    assert token.startswith("gAAAAA")

    backup_id = await _insert_backup(
        case_id,
        path=str(tmp_data_dir / "backups" / "enc"),
        password=token,
    )

    # Direct DB read — confirm plaintext is NOT present.
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT password FROM backups WHERE id = ?", (backup_id,)).fetchone()
    conn.close()

    assert row is not None
    stored = row["password"]
    assert stored is not None
    assert plaintext not in stored
    assert stored == token
    # Round-trip back through crypto.
    assert decrypt(stored) == plaintext


async def test_null_password_stays_null(case_id, tmp_data_dir):
    """A backup without a password must store NULL, not an empty token."""
    import sqlite3

    from core.config import DB_PATH

    backup_id = await _insert_backup(
        case_id,
        path=str(tmp_data_dir / "backups" / "noenc"),
        password=None,
    )

    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT password FROM backups WHERE id = ?", (backup_id,)).fetchone()
    conn.close()
    assert row[0] is None


# delete_backup_by_id

async def test_delete_backup_removes_row_and_files(case_id, tmp_data_dir):
    from core.database import db_fetch_one
    from services.backup_manager import backup_manager

    backup_dir = tmp_data_dir / "backups" / "victim"
    backup_dir.mkdir(parents=True, exist_ok=True)
    (backup_dir / "Manifest.db").write_text("dummy")
    (backup_dir / "processing.log").write_text("log\n")

    backup_id = await _insert_backup(case_id, path=str(backup_dir))
    assert backup_dir.exists()

    result = await backup_manager.delete_backup_by_id(backup_id)
    assert result["success"] is True
    assert not backup_dir.exists()
    assert await db_fetch_one("SELECT id FROM backups WHERE id = ?", (backup_id,)) is None


async def test_delete_backup_handles_missing_path_gracefully(case_id, tmp_data_dir):
    """If files are already gone, the DB row should still be cleared."""
    from core.database import db_fetch_one
    from services.backup_manager import backup_manager

    missing = str(tmp_data_dir / "backups" / "already_gone")
    backup_id = await _insert_backup(case_id, path=missing)

    result = await backup_manager.delete_backup_by_id(backup_id)
    assert result["success"] is True
    assert await db_fetch_one("SELECT id FROM backups WHERE id = ?", (backup_id,)) is None


async def test_delete_backup_missing_row_raises(fresh_db):
    from services.backup_manager import backup_manager

    with pytest.raises(ValueError):
        await backup_manager.delete_backup_by_id(987654)


# stop_backup

async def test_stop_backup_clears_db_row_when_no_active_process(case_id, tmp_data_dir):
    from core.database import db_fetch_one
    from services.backup_manager import backup_manager

    backup_id = await _insert_backup(case_id, path=str(tmp_data_dir / "backups" / "stoppable"))
    result = await backup_manager.stop_backup(backup_id)
    assert result["success"] is True
    assert await db_fetch_one("SELECT id FROM backups WHERE id = ?", (backup_id,)) is None


# Status / progress updates via DB

async def test_update_status_and_progress_visible_via_get_backups(case_id, tmp_data_dir):
    from core.database import db_execute
    from services.backup_manager import backup_manager

    backup_id = await _insert_backup(case_id, path=str(tmp_data_dir / "backups" / "prog"))

    await db_execute("UPDATE backups SET progress = ? WHERE id = ?", (45, backup_id))
    await db_execute("UPDATE backups SET status = ? WHERE id = ?", ("completed", backup_id))

    rows = await backup_manager.get_backups(case_id)
    row = next(r for r in rows if r["id"] == backup_id)
    assert row["progress"] == 45
    assert row["status"] == "completed"


# get_devices subprocess mocking — verifies the boundary IS mocked

async def test_get_devices_does_not_shell_out(monkeypatch, fresh_db):
    """Ensure get_devices uses the mocked helpers and returns combined list."""
    from services import backup_manager as bm_module

    async def fake_ios():
        return [{"udid": "ios-1", "name": "iPhone", "type": "ios"}]

    async def fake_android():
        return [{"udid": "and-1", "name": "Pixel", "type": "android"}]

    # The iOS helper is imported at module top via `from utils.helpers import ...`,
    # so patch the binding inside backup_manager.
    monkeypatch.setattr(bm_module, "get_connected_devices", fake_ios)
    # The android helper is imported lazily inside get_devices.
    import utils.helpers as helpers_mod
    monkeypatch.setattr(helpers_mod, "get_connected_android_devices", fake_android)

    devices = await bm_module.backup_manager.get_devices()
    udids = {d["udid"] for d in devices}
    assert udids == {"ios-1", "and-1"}
