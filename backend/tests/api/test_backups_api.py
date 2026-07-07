"""Tests for api/backups.py."""

from __future__ import annotations

from pathlib import Path

import pytest


async def _insert_backup(
    case_id: int,
    name: str = "B",
    udid: str = "u-1",
    device_name: str = "iPhone",
    path: str = "/tmp/x",
    status: str = "completed",
    password: str | None = None,
    backup_type: str = "ios",
) -> int:
    from core.database import db_execute_return_id
    return await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, password, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (name, udid, device_name, path, status, password, case_id, backup_type),
    )


@pytest.fixture
async def case_id(sample_case) -> int:
    return sample_case["id"]


@pytest.fixture(autouse=True)
def _mock_device_helpers(monkeypatch):
    """Block ALL real subprocess calls for device enumeration."""
    from services import backup_manager as bm
    import utils.helpers as helpers_mod

    async def _no_ios():
        return []

    async def _no_android():
        return []

    monkeypatch.setattr(bm, "get_connected_devices", _no_ios)
    monkeypatch.setattr(helpers_mod, "get_connected_android_devices", _no_android)
    monkeypatch.setattr(helpers_mod, "get_connected_devices", _no_ios)


# GET /api/backups

async def test_list_backups_empty(client, fresh_db):
    resp = await client.get("/api/backups")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_backups_for_case(client, case_id, tmp_data_dir):
    bp = tmp_data_dir / "backups" / "list_one"
    bp.mkdir(parents=True, exist_ok=True)
    bid = await _insert_backup(case_id, name="One", path=str(bp))

    resp = await client.get(f"/api/backups?case_id={case_id}")
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == bid
    assert row["name"] == "One"
    assert row["path"] == str(bp)


async def test_list_backups_never_exposes_password_field(client, case_id, tmp_data_dir):
    """BackupInfo response model must not surface the encrypted password column."""
    from core.crypto import encrypt

    bp = tmp_data_dir / "backups" / "secret"
    bp.mkdir(parents=True, exist_ok=True)
    token = encrypt("very-secret-pass")
    await _insert_backup(case_id, name="Secret", path=str(bp), password=token)

    resp = await client.get(f"/api/backups?case_id={case_id}")
    assert resp.status_code == 200
    body = resp.json()
    # No row may contain the password column at all, encrypted or not.
    for row in body:
        assert "password" not in row
    # And the plaintext must never appear in the serialized payload.
    assert "very-secret-pass" not in resp.text
    assert token not in resp.text


# GET /api/backups/devices

async def test_list_devices_returns_empty_with_no_devices(client, fresh_db):
    resp = await client.get("/api/backups/devices")
    assert resp.status_code == 200
    assert resp.json() == []


# DELETE /api/backups/{id}

async def test_delete_backup_success(client, case_id, tmp_data_dir):
    from core.database import db_fetch_one

    bp = tmp_data_dir / "backups" / "del_me"
    bp.mkdir(parents=True, exist_ok=True)
    (bp / "Manifest.db").write_text("x")
    bid = await _insert_backup(case_id, path=str(bp))

    resp = await client.delete(f"/api/backups/{bid}")
    assert resp.status_code == 200
    assert "deleted" in resp.json()["message"].lower()
    assert not bp.exists()
    assert await db_fetch_one("SELECT id FROM backups WHERE id = ?", (bid,)) is None


async def test_delete_backup_404(client, fresh_db):
    resp = await client.delete("/api/backups/424242")
    assert resp.status_code == 404


# POST /api/backups/{id}/stop

async def test_stop_backup_clears_row(client, case_id, tmp_data_dir):
    from core.database import db_fetch_one

    bp = tmp_data_dir / "backups" / "stop_me"
    bp.mkdir(parents=True, exist_ok=True)
    bid = await _insert_backup(case_id, path=str(bp), status="in_progress")

    resp = await client.post(f"/api/backups/{bid}/stop")
    assert resp.status_code == 200
    assert resp.json()["message"]
    assert await db_fetch_one("SELECT id FROM backups WHERE id = ?", (bid,)) is None


# GET /api/backups/{id}/log

async def test_get_backup_log_returns_file(client, case_id, tmp_data_dir):
    bp = tmp_data_dir / "backups" / "with_log"
    bp.mkdir(parents=True, exist_ok=True)
    (bp / "processing.log").write_text("log line A\nlog line B\n")
    bid = await _insert_backup(case_id, path=str(bp))

    resp = await client.get(f"/api/backups/{bid}/log")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/plain")
    assert "log line A" in resp.text


async def test_get_backup_log_missing_backup_404(client, fresh_db):
    resp = await client.get("/api/backups/9001/log")
    assert resp.status_code == 404


async def test_get_backup_log_missing_logfile_404(client, case_id, tmp_data_dir):
    bp = tmp_data_dir / "backups" / "no_log"
    bp.mkdir(parents=True, exist_ok=True)
    bid = await _insert_backup(case_id, path=str(bp))

    resp = await client.get(f"/api/backups/{bid}/log")
    assert resp.status_code == 404


# POST /api/backups/{id}/open-log

async def test_open_backup_log_404_backup(client, fresh_db):
    resp = await client.post("/api/backups/9001/open-log")
    assert resp.status_code == 404


async def test_open_backup_log_404_log(client, case_id, tmp_data_dir):
    bp = tmp_data_dir / "backups" / "no_open_log"
    bp.mkdir(parents=True, exist_ok=True)
    bid = await _insert_backup(case_id, path=str(bp))

    resp = await client.post(f"/api/backups/{bid}/open-log")
    assert resp.status_code == 404


# GET /api/backups/{id}/download

async def test_download_backup_returns_zip(client, case_id, tmp_data_dir):
    bp = tmp_data_dir / "backups" / "downloadable"
    bp.mkdir(parents=True, exist_ok=True)
    (bp / "Manifest.db").write_text("data")
    bid = await _insert_backup(case_id, name="DL", path=str(bp))

    resp = await client.get(f"/api/backups/{bid}/download")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert resp.content[:2] == b"PK"


async def test_download_backup_missing_record_404(client, fresh_db):
    resp = await client.get("/api/backups/9001/download")
    assert resp.status_code == 404


async def test_download_backup_path_outside_dir_403(client, case_id, tmp_data_dir):
    rogue = tmp_data_dir / "data" / "rogue_backup"
    rogue.mkdir(parents=True, exist_ok=True)
    (rogue / "a.txt").write_text("a")
    bid = await _insert_backup(case_id, name="Rogue", path=str(rogue))

    resp = await client.get(f"/api/backups/{bid}/download")
    assert resp.status_code == 403


# POST /api/backups/validate

async def test_validate_backup_missing_path_400(client, fresh_db):
    resp = await client.post("/api/backups/validate", json={"input_path": "/no/such/path"})
    assert resp.status_code == 400


# GET /api/backups/{id}/stream - SSE smoke

async def test_stream_unknown_task_404(client, fresh_db):
    resp = await client.get("/api/backups/9999/stream")
    assert resp.status_code == 404


# POST /api/backups - encryption-at-rest end-to-end

async def test_start_backup_persists_encrypted_password(client, case_id, tmp_data_dir, monkeypatch):
    """When a password is supplied, the DB column must hold ciphertext, not plaintext."""
    import sqlite3
    from core.config import DB_PATH
    from services import backup_manager as bm

    plaintext = "secret-passcode-xyz"

    async def fake_devices(_self):
        return [{"udid": "test-udid", "name": "Test iPhone", "type": "ios"}]

    # Monkeypatch the get_devices method on the manager instance (start_backup calls self.get_devices).
    monkeypatch.setattr(bm.BackupManager, "get_devices", fake_devices)

    # Stop the background subprocess loop from running for real.
    async def fake_loop(self, *args, **kwargs):
        return None

    monkeypatch.setattr(bm.BackupManager, "_run_backup_loop", fake_loop)
    monkeypatch.setattr(bm.BackupManager, "_run_android_backup_loop", fake_loop)

    payload = {
        "udid": "test-udid",
        "name": "EncBackup",
        "password": plaintext,
        "case_id": case_id,
    }
    resp = await client.post("/api/backups", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    backup_id = body["backup_id"]

    # Plaintext must not appear in the response payload.
    assert plaintext not in resp.text

    # Stored value must be a Fernet token, not the plaintext.
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT password FROM backups WHERE id = ?", (backup_id,)).fetchone()
    conn.close()
    assert row is not None
    stored = row[0]
    assert stored is not None
    assert stored != plaintext
    assert plaintext not in stored
    assert stored.startswith("gAAAAA")

    # And round-trip decrypt works.
    from core.crypto import decrypt
    assert decrypt(stored) == plaintext


async def test_start_backup_unknown_device_400(client, case_id, monkeypatch):
    from services import backup_manager as bm

    async def fake_devices(_self):
        return []

    monkeypatch.setattr(bm.BackupManager, "get_devices", fake_devices)

    resp = await client.post(
        "/api/backups",
        json={"udid": "missing", "name": "X", "case_id": case_id},
    )
    assert resp.status_code == 400
