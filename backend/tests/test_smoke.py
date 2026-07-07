"""Smoke test for the test harness itself."""

from pathlib import Path


def test_config_paths_redirected_to_tmp(tmp_data_dir):
    """Config constants should point inside the session tmp dir, never the user home."""
    from core.config import BASE_DIR, DB_PATH, REPORTS_DIR, BACKUPS_DIR, PHOTOS_DIR

    assert Path(BASE_DIR) == tmp_data_dir
    assert Path(DB_PATH).is_relative_to(tmp_data_dir)
    assert Path(REPORTS_DIR).is_relative_to(tmp_data_dir)
    assert Path(BACKUPS_DIR).is_relative_to(tmp_data_dir)
    assert Path(PHOTOS_DIR).is_relative_to(tmp_data_dir)


def test_fresh_db_creates_schema(fresh_db):
    import sqlite3

    conn = sqlite3.connect(fresh_db)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    expected = {"profiles", "reports", "backups", "tasks", "notes", "settings",
                "cases", "export_jobs", "photo_extractions"}
    assert expected.issubset(tables)


def test_crypto_roundtrip_uses_stubbed_key():
    from core.crypto import encrypt, decrypt

    token = encrypt("hello")
    assert token != "hello"
    assert decrypt(token) == "hello"


async def test_test_app_serves_cases_endpoint(client):
    """Bare smoke check that the assembled app responds."""
    resp = await client.get("/api/cases")
    assert resp.status_code == 200
    assert resp.json() == []
