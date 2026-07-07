"""HTTP-level tests for /api/cases router."""

from __future__ import annotations

import pytest


def _case_payload(**overrides):
    base = {
        "name": "API Case",
        "case_number": "API-001",
        "client_name": "Client",
        "client_phone": "+1-555-0101",
        "client_email": "client@example.com",
        "description": "desc",
        "status": "Active",
        "priority": "Medium",
    }
    base.update(overrides)
    return base


async def test_list_cases_empty(client, fresh_db):
    resp = await client.get("/api/cases")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_case_returns_case_model(client, fresh_db):
    resp = await client.post("/api/cases", json=_case_payload())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "API Case"
    assert body["status"] == "Active"
    assert isinstance(body["id"], int)
    assert "created_at" in body


async def test_list_cases_sorted_by_last_visited_desc(client, fresh_db):
    from core.database import db_execute
    from services.case_manager import case_manager

    a = await case_manager.create_case(_case_payload(name="A"))
    b = await case_manager.create_case(_case_payload(name="B"))
    c = await case_manager.create_case(_case_payload(name="C"))

    await db_execute("UPDATE cases SET last_visited_at = ? WHERE id = ?", ("2026-01-01T00:00:00.001", c))
    await db_execute("UPDATE cases SET last_visited_at = ? WHERE id = ?", ("2026-01-01T00:00:00.002", a))
    await db_execute("UPDATE cases SET last_visited_at = ? WHERE id = ?", ("2026-01-01T00:00:00.003", b))

    resp = await client.get("/api/cases")
    assert resp.status_code == 200
    names_in_order = [row["name"] for row in resp.json()]
    assert names_in_order[:3] == ["B", "A", "C"]


async def test_get_case_by_id(client, fresh_db):
    create = await client.post("/api/cases", json=_case_payload(name="Lookup"))
    cid = create.json()["id"]

    resp = await client.get(f"/api/cases/{cid}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Lookup"


async def test_get_case_missing_returns_404(client, fresh_db):
    resp = await client.get("/api/cases/424242")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Case not found"


async def test_put_case_updates_fields(client, fresh_db):
    create = await client.post("/api/cases", json=_case_payload(name="Before"))
    cid = create.json()["id"]

    resp = await client.put(f"/api/cases/{cid}", json={"name": "After", "priority": "High"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "After"
    assert body["priority"] == "High"


async def test_put_case_empty_payload_returns_400(client, fresh_db):
    create = await client.post("/api/cases", json=_case_payload())
    cid = create.json()["id"]

    resp = await client.put(f"/api/cases/{cid}", json={})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "No fields to update"


async def test_put_case_missing_returns_404(client, fresh_db):
    resp = await client.put("/api/cases/999999", json={"name": "X"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Case not found"


async def test_visit_case_updates_timestamp(client, fresh_db):
    create = await client.post("/api/cases", json=_case_payload(name="Visited"))
    cid = create.json()["id"]
    assert create.json()["last_visited_at"] is None

    resp = await client.post(f"/api/cases/{cid}/visit")
    assert resp.status_code == 200
    assert resp.json()["last_visited_at"] is not None


async def test_visit_case_missing_returns_404(client, fresh_db):
    resp = await client.post("/api/cases/12345/visit")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Case not found"


async def test_delete_case_returns_success_and_removes(client, fresh_db):
    create = await client.post("/api/cases", json=_case_payload(name="Gone"))
    cid = create.json()["id"]

    resp = await client.delete(f"/api/cases/{cid}")
    assert resp.status_code == 200
    assert resp.json()["message"] == "Case and associated data deleted successfully"

    follow = await client.get(f"/api/cases/{cid}")
    assert follow.status_code == 404


async def test_delete_case_missing_returns_404(client, fresh_db):
    resp = await client.delete("/api/cases/55555")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Case not found"


# ---------------------------------------------------------------------------
# Task / Note routes (exposed via /api/dashboard, scoped by case_id query)
# ---------------------------------------------------------------------------
async def test_dashboard_task_crud_scoped_by_case(client, fresh_db):
    case = await client.post("/api/cases", json=_case_payload(name="TaskCase"))
    cid = case.json()["id"]

    # Create
    create = await client.post("/api/dashboard/tasks", json={
        "content": "Examine logs",
        "description": "trace artifact",
        "priority": "High",
        "case_id": cid,
    })
    assert create.status_code == 200, create.text
    task = create.json()
    assert task["content"] == "Examine logs"
    assert task["completed"] is False

    # List scoped by case
    listed = await client.get("/api/dashboard/tasks", params={"case_id": cid})
    assert listed.status_code == 200
    assert any(t["id"] == task["id"] for t in listed.json())

    # Toggle complete
    toggled = await client.put(f"/api/dashboard/tasks/{task['id']}")
    assert toggled.status_code == 200
    assert toggled.json()["completed"] is True

    # Toggle missing -> 404
    miss = await client.put("/api/dashboard/tasks/999999")
    assert miss.status_code == 404
    assert miss.json()["detail"] == "Task not found"

    # Delete
    dele = await client.delete(f"/api/dashboard/tasks/{task['id']}")
    assert dele.status_code == 200
    assert dele.json()["message"] == "Task deleted"

    # Delete missing -> 404
    miss_del = await client.delete("/api/dashboard/tasks/999999")
    assert miss_del.status_code == 404


async def test_dashboard_note_crud_scoped_by_case(client, fresh_db):
    case = await client.post("/api/cases", json=_case_payload(name="NoteCase"))
    cid = case.json()["id"]

    create = await client.post("/api/dashboard/notes", json={
        "content": "Found PII",
        "description": "anomaly",
        "case_id": cid,
    })
    assert create.status_code == 200, create.text
    note = create.json()
    assert note["content"] == "Found PII"

    listed = await client.get("/api/dashboard/notes", params={"case_id": cid})
    assert listed.status_code == 200
    assert any(n["id"] == note["id"] for n in listed.json())

    dele = await client.delete(f"/api/dashboard/notes/{note['id']}")
    assert dele.status_code == 200
    assert dele.json()["message"] == "Note deleted"

    miss = await client.delete("/api/dashboard/notes/424242")
    assert miss.status_code == 404
    assert miss.json()["detail"] == "Note not found"
