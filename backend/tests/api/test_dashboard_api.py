"""Tests for api/dashboard.py."""

from __future__ import annotations

import pytest


@pytest.fixture
async def case_id(sample_case) -> int:
    return sample_case["id"]


# Tasks

async def test_get_tasks_empty(client, fresh_db):
    resp = await client.get("/api/dashboard/tasks")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_task_and_list(client, case_id):
    payload = {
        "content": "Process backup",
        "description": "Run iLEAPP on the new acquisition",
        "priority": "High",
        "case_id": case_id,
    }
    resp = await client.post("/api/dashboard/tasks", json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["content"] == "Process backup"
    assert body["priority"] == "High"
    assert body["completed"] is False
    assert "id" in body and "created_at" in body

    # List by case
    resp2 = await client.get(f"/api/dashboard/tasks?case_id={case_id}")
    assert resp2.status_code == 200
    assert len(resp2.json()) == 1


async def test_toggle_task_flips_completed(client, case_id):
    resp = await client.post(
        "/api/dashboard/tasks",
        json={"content": "Do thing", "priority": "Medium", "case_id": case_id},
    )
    task_id = resp.json()["id"]

    # First toggle: false -> true
    r1 = await client.put(f"/api/dashboard/tasks/{task_id}")
    assert r1.status_code == 200
    assert r1.json()["completed"] is True

    # Second toggle: true -> false
    r2 = await client.put(f"/api/dashboard/tasks/{task_id}")
    assert r2.status_code == 200
    assert r2.json()["completed"] is False


async def test_toggle_unknown_task_404(client, fresh_db):
    resp = await client.put("/api/dashboard/tasks/99999")
    assert resp.status_code == 404


async def test_delete_task(client, case_id):
    from core.database import db_fetch_one

    resp = await client.post(
        "/api/dashboard/tasks",
        json={"content": "Delete me", "priority": "Low", "case_id": case_id},
    )
    task_id = resp.json()["id"]

    r2 = await client.delete(f"/api/dashboard/tasks/{task_id}")
    assert r2.status_code == 200
    assert "deleted" in r2.json()["message"].lower()
    assert await db_fetch_one("SELECT id FROM tasks WHERE id = ?", (task_id,)) is None


async def test_delete_unknown_task_404(client, fresh_db):
    resp = await client.delete("/api/dashboard/tasks/424242")
    assert resp.status_code == 404


async def test_tasks_scoped_by_case(client, case_id):
    from services.case_manager import case_manager

    other = await case_manager.create_case({
        "name": "Other", "status": "Active", "priority": "Medium",
    })

    await client.post(
        "/api/dashboard/tasks",
        json={"content": "A", "priority": "Medium", "case_id": case_id},
    )
    await client.post(
        "/api/dashboard/tasks",
        json={"content": "B", "priority": "Medium", "case_id": other},
    )

    a_resp = await client.get(f"/api/dashboard/tasks?case_id={case_id}")
    b_resp = await client.get(f"/api/dashboard/tasks?case_id={other}")
    assert {t["content"] for t in a_resp.json()} == {"A"}
    assert {t["content"] for t in b_resp.json()} == {"B"}


# Notes

async def test_get_notes_empty(client, fresh_db):
    resp = await client.get("/api/dashboard/notes")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_note_and_list(client, case_id):
    resp = await client.post(
        "/api/dashboard/notes",
        json={"content": "Found a clue", "description": "in chat.db", "case_id": case_id},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["content"] == "Found a clue"
    assert body["description"] == "in chat.db"

    resp2 = await client.get(f"/api/dashboard/notes?case_id={case_id}")
    assert resp2.status_code == 200
    assert len(resp2.json()) == 1


async def test_delete_note(client, case_id):
    from core.database import db_fetch_one

    r = await client.post(
        "/api/dashboard/notes",
        json={"content": "X", "case_id": case_id},
    )
    note_id = r.json()["id"]
    r2 = await client.delete(f"/api/dashboard/notes/{note_id}")
    assert r2.status_code == 200
    assert await db_fetch_one("SELECT id FROM notes WHERE id = ?", (note_id,)) is None


async def test_delete_unknown_note_404(client, fresh_db):
    resp = await client.delete("/api/dashboard/notes/333333")
    assert resp.status_code == 404


# Recent activity

async def test_activity_empty(client, fresh_db):
    resp = await client.get("/api/dashboard/activity")
    assert resp.status_code == 200
    assert resp.json() == {"activities": []}


async def test_activity_includes_backups_and_reports(client, case_id, tmp_data_dir):
    from core.database import db_execute_return_id

    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("MyBackup", "u", "P", str(tmp_data_dir / "backups" / "act_bk"), "completed", case_id, "ios"),
    )
    await db_execute_return_id(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("MyReport", str(tmp_data_dir / "reports" / "act_rp"), "ileapp", case_id),
    )

    resp = await client.get(f"/api/dashboard/activity?case_id={case_id}")
    assert resp.status_code == 200
    activities = resp.json()["activities"]
    names = {a["name"] for a in activities}
    types = {a["type"] for a in activities}
    assert names == {"MyBackup", "MyReport"}
    assert types == {"backup", "report"}


async def test_activity_does_not_leak_backup_password(client, case_id, tmp_data_dir):
    """Activity feed pulls from the backups table — ensure password column never leaks."""
    from core.crypto import encrypt
    from core.database import db_execute_return_id

    token = encrypt("totally-secret-pw")
    await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, password, case_id, type) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ("Encr", "u", "P", str(tmp_data_dir / "backups" / "ac_enc"), "completed", token, case_id, "ios"),
    )

    resp = await client.get(f"/api/dashboard/activity?case_id={case_id}")
    assert resp.status_code == 200
    assert "totally-secret-pw" not in resp.text
    assert token not in resp.text
    for a in resp.json()["activities"]:
        assert "password" not in a
