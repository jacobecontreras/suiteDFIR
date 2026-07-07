"""Tests for pydantic models in core.models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from core.models import (
    BackupRequest,
    CaseBase,
    CaseCreate,
    CaseStatus,
    CaseUpdate,
    ExportJobStatus,
    NoteCreate,
    Priority,
    ProcessRequest,
    ProfileCreate,
    TaskCreate,
    ToolName,
)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class TestEnums:
    def test_case_status_values(self):
        assert CaseStatus.ACTIVE.value == "Active"
        assert CaseStatus.ARCHIVED.value == "Archived"
        assert CaseStatus.CLOSED.value == "Closed"

    def test_priority_values(self):
        assert {p.value for p in Priority} == {"Low", "Medium", "High", "Critical"}

    def test_tool_name_values(self):
        assert {t.value for t in ToolName} == {"ileapp", "aleapp"}

    def test_export_job_status_values(self):
        assert {s.value for s in ExportJobStatus} == {
            "pending", "processing", "completed", "failed"
        }


# ---------------------------------------------------------------------------
# CaseBase / CaseCreate
# ---------------------------------------------------------------------------

class TestCaseModels:
    def test_minimum_required_field(self):
        c = CaseCreate(name="My Case")
        assert c.name == "My Case"
        # Optional fields default to None / sensible enum defaults
        assert c.case_number is None
        assert c.client_name is None
        assert c.client_phone is None
        assert c.client_email is None
        assert c.description is None
        assert c.status == CaseStatus.ACTIVE
        assert c.priority == Priority.MEDIUM

    def test_missing_name_raises(self):
        with pytest.raises(ValidationError):
            CaseCreate()  # type: ignore[call-arg]

    def test_status_enum_coercion_from_string(self):
        c = CaseCreate(name="X", status="Closed")
        assert c.status == CaseStatus.CLOSED

    def test_invalid_status_raises(self):
        with pytest.raises(ValidationError):
            CaseCreate(name="X", status="not-a-status")

    def test_invalid_priority_raises(self):
        with pytest.raises(ValidationError):
            CaseCreate(name="X", priority="ultra")

    def test_all_fields_populated(self):
        c = CaseBase(
            name="N",
            case_number="C1",
            client_name="Bob",
            client_phone="555",
            client_email="bob@x.com",
            description="desc",
            status=CaseStatus.ARCHIVED,
            priority=Priority.HIGH,
        )
        assert c.client_email == "bob@x.com"
        assert c.status == CaseStatus.ARCHIVED
        assert c.priority == Priority.HIGH

    def test_case_update_all_optional(self):
        # An empty update is valid
        u = CaseUpdate()
        assert u.name is None
        assert u.status is None
        assert u.priority is None

    def test_case_update_partial(self):
        u = CaseUpdate(status="Closed")
        assert u.status == CaseStatus.CLOSED
        assert u.name is None


# ---------------------------------------------------------------------------
# Profile / Task / Note / Backup / Process models
# ---------------------------------------------------------------------------

class TestProfileCreate:
    def test_valid(self):
        p = ProfileCreate(name="default", tool="ileapp", modules=["m1", "m2"])
        assert p.name == "default"
        assert p.tool == ToolName.ILEAPP
        assert p.modules == ["m1", "m2"]

    def test_invalid_tool_raises(self):
        with pytest.raises(ValidationError):
            ProfileCreate(name="x", tool="nope", modules=[])

    def test_missing_modules_raises(self):
        with pytest.raises(ValidationError):
            ProfileCreate(name="x", tool="ileapp")  # type: ignore[call-arg]


class TestTaskCreate:
    def test_defaults(self):
        t = TaskCreate(content="Do it", case_id=1)
        assert t.priority == Priority.MEDIUM
        assert t.description is None
        assert t.case_id == 1

    def test_missing_required_raises(self):
        with pytest.raises(ValidationError):
            TaskCreate(content="x")  # type: ignore[call-arg]
        with pytest.raises(ValidationError):
            TaskCreate(case_id=1)  # type: ignore[call-arg]


class TestNoteCreate:
    def test_minimum(self):
        n = NoteCreate(content="text", case_id=42)
        assert n.content == "text"
        assert n.case_id == 42
        assert n.description is None

    def test_missing_required_raises(self):
        with pytest.raises(ValidationError):
            NoteCreate(content="x")  # type: ignore[call-arg]


class TestBackupRequest:
    def test_valid_without_password(self):
        b = BackupRequest(udid="abc", name="iPhone", case_id=1)
        assert b.password is None

    def test_missing_required_raises(self):
        with pytest.raises(ValidationError):
            BackupRequest(udid="abc", name="iPhone")  # type: ignore[call-arg]


class TestProcessRequest:
    def test_defaults_and_required_fields(self):
        r = ProcessRequest(
            tool="ileapp",
            input_path="/tmp/in",
            selected_modules=["m1"],
            case_name="Case",
            case_id=1,
        )
        assert r.tool == ToolName.ILEAPP
        assert r.timezone_offset == "UTC"
        assert r.report_name is None
        assert r.output_folder is None
        assert r.password is None

    def test_invalid_tool_raises(self):
        with pytest.raises(ValidationError):
            ProcessRequest(
                tool="ghost",
                input_path="/tmp",
                selected_modules=[],
                case_name="X",
                case_id=1,
            )

    def test_missing_required_raises(self):
        with pytest.raises(ValidationError):
            ProcessRequest(  # type: ignore[call-arg]
                tool="ileapp",
                selected_modules=[],
                case_name="X",
                case_id=1,
            )
