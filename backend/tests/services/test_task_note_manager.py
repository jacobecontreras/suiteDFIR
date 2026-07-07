"""Tests for services.task_note_manager.TaskNoteManager.

Tasks and notes are scoped per case_id. We seed a case via sample_case so
foreign-keyed rows have a parent (though the schema does not strictly
enforce FK constraints, the API treats case_id as required).
"""

from __future__ import annotations

import pytest

from core.models import NoteCreate, TaskCreate


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
async def test_create_task_returns_row(sample_case):
    from services.task_note_manager import task_note_manager

    payload = TaskCreate(
        content="Triage device",
        description="d",
        priority="High",
        case_id=sample_case["id"],
    )
    row = await task_note_manager.create_task(payload)
    assert row["content"] == "Triage device"
    assert row["case_id"] == sample_case["id"]
    assert row["completed"] in (0, False)


async def test_get_tasks_scoped_by_case(sample_case, fresh_db):
    from services.case_manager import case_manager
    from services.task_note_manager import task_note_manager

    other_case_id = await case_manager.create_case({"name": "Other", "status": "Active", "priority": "Low"})

    await task_note_manager.create_task(TaskCreate(content="A", case_id=sample_case["id"]))
    await task_note_manager.create_task(TaskCreate(content="B", case_id=sample_case["id"]))
    await task_note_manager.create_task(TaskCreate(content="X", case_id=other_case_id))

    sample_tasks = await task_note_manager.get_tasks(sample_case["id"])
    assert {t["content"] for t in sample_tasks} == {"A", "B"}

    all_tasks = await task_note_manager.get_tasks()
    assert {t["content"] for t in all_tasks} == {"A", "B", "X"}


async def test_toggle_task_status_flips_completed(sample_case):
    from services.task_note_manager import task_note_manager

    row = await task_note_manager.create_task(
        TaskCreate(content="Flip me", case_id=sample_case["id"])
    )
    assert not row["completed"]

    toggled = await task_note_manager.toggle_task_status(row["id"])
    assert toggled["completed"]  # truthy (1)

    toggled = await task_note_manager.toggle_task_status(row["id"])
    assert not toggled["completed"]


async def test_toggle_task_missing_raises(fresh_db):
    from services.task_note_manager import task_note_manager

    with pytest.raises(ValueError, match="not found"):
        await task_note_manager.toggle_task_status(987654)


async def test_delete_task_removes_row(sample_case):
    from services.task_note_manager import task_note_manager

    row = await task_note_manager.create_task(
        TaskCreate(content="bye", case_id=sample_case["id"])
    )
    result = await task_note_manager.delete_task(row["id"])
    assert result == {"message": "Task deleted"}
    assert await task_note_manager.get_task_by_id(row["id"]) is None


async def test_delete_task_missing_raises(fresh_db):
    from services.task_note_manager import task_note_manager

    with pytest.raises(ValueError, match="not found"):
        await task_note_manager.delete_task(987654)


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------
async def test_create_note_returns_row(sample_case):
    from services.task_note_manager import task_note_manager

    row = await task_note_manager.create_note(
        NoteCreate(content="Discovered artifact", description="d", case_id=sample_case["id"])
    )
    assert row["content"] == "Discovered artifact"
    assert row["description"] == "d"
    assert row["case_id"] == sample_case["id"]


async def test_get_notes_scoped_by_case(sample_case, fresh_db):
    from services.case_manager import case_manager
    from services.task_note_manager import task_note_manager

    other = await case_manager.create_case({"name": "Other", "status": "Active", "priority": "Low"})

    await task_note_manager.create_note(NoteCreate(content="N1", case_id=sample_case["id"]))
    await task_note_manager.create_note(NoteCreate(content="N2", case_id=other))

    s_notes = await task_note_manager.get_notes(sample_case["id"])
    assert {n["content"] for n in s_notes} == {"N1"}

    all_notes = await task_note_manager.get_notes()
    assert {n["content"] for n in all_notes} == {"N1", "N2"}


async def test_delete_note_removes_row(sample_case):
    from services.task_note_manager import task_note_manager

    row = await task_note_manager.create_note(
        NoteCreate(content="gone", case_id=sample_case["id"])
    )
    result = await task_note_manager.delete_note(row["id"])
    assert result == {"message": "Note deleted"}
    remaining = await task_note_manager.get_notes(sample_case["id"])
    assert all(n["id"] != row["id"] for n in remaining)


async def test_delete_note_missing_raises(fresh_db):
    from services.task_note_manager import task_note_manager

    with pytest.raises(ValueError, match="not found"):
        await task_note_manager.delete_note(424242)
