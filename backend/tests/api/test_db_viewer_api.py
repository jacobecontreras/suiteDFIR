"""
Tests for the api/db_viewer.py FastAPI router.

Uses the `client` async ASGI fixture; databases are real SQLite files written
into the per-session temp report directory (no mocks of sqlite).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from core.database import db_execute_return_id
from services.case_manager import case_manager
from services.db_viewer_manager import db_viewer_manager


@pytest.fixture
async def api_case(fresh_db, tmp_data_dir, make_sample_db):
    """
    Build a case with a report directory containing a single `widgets.db`.
    Returns (case_id, report_id, db_rel_path).
    """
    case_id = await case_manager.create_case({"name": "API DBV Case"})
    report_dir = tmp_data_dir / "reports" / f"api-case-{case_id}"
    if report_dir.exists():
        import shutil
        shutil.rmtree(report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)

    report_id = await db_execute_return_id(
        "INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)",
        ("API Report", str(report_dir), "ileapp", case_id),
    )

    make_sample_db(report_dir / "widgets.db", schema="widgets")
    db_viewer_manager._case_report_paths.pop(case_id, None)

    rel = f"{report_id}/widgets.db"
    yield case_id, report_id, rel

    db_viewer_manager.close_all()
    db_viewer_manager._case_report_paths.pop(case_id, None)


# ---------------------------------------------------------------------------
# GET /api/db_viewer/cases/{case_id}/databases
# ---------------------------------------------------------------------------
class TestListDatabasesEndpoint:
    async def test_lists_db_files_under_report(self, client, api_case):
        case_id, report_id, _rel = api_case
        resp = await client.get(f"/api/db_viewer/cases/{case_id}/databases")
        assert resp.status_code == 200
        body = resp.json()
        assert "databases" in body
        names = [d["name"] for d in body["databases"]]
        assert names == ["widgets.db"]
        assert body["databases"][0]["relativePath"] == f"{report_id}/widgets.db"
        assert body["databases"][0]["size"] > 0

    async def test_empty_when_no_reports(self, client, fresh_db):
        case_id = await case_manager.create_case({"name": "Empty case for API"})
        resp = await client.get(f"/api/db_viewer/cases/{case_id}/databases")
        assert resp.status_code == 200
        assert resp.json() == {"databases": []}


# ---------------------------------------------------------------------------
# GET /databases/schema
# ---------------------------------------------------------------------------
class TestSchemaEndpoint:
    async def test_returns_full_schema(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/schema",
            params={"db_path": rel},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert {"tables", "indexes", "views", "triggers"}.issubset(body.keys())
        tables = body["tables"]
        assert len(tables) == 1
        widgets = tables[0]
        assert widgets["name"] == "widgets"
        assert widgets["rowCount"] == 4
        col_names = [c["name"] for c in widgets["columns"]]
        assert col_names == ["id", "name", "color"]

    async def test_unknown_db_returns_404(self, client, api_case):
        case_id, _rid, _rel = api_case
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/schema",
            params={"db_path": "999/missing.db"},
        )
        assert resp.status_code == 404

    async def test_path_traversal_rejected(self, client, api_case, tmp_data_dir, make_sample_db):
        case_id, report_id, _rel = api_case
        # Plant a db that is reachable via .. but outside the report dir.
        outside = tmp_data_dir / "reports" / "outside.db"
        make_sample_db(outside, schema="widgets")
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/schema",
            params={"db_path": f"{report_id}/../outside.db"},
        )
        # ValueError from manager -> 404 by router contract
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /databases/data
# ---------------------------------------------------------------------------
class TestTableDataEndpoint:
    async def test_basic_pagination(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/data",
            params={
                "db_path": rel,
                "table_name": "widgets",
                "page": 0,
                "page_size": 2,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["columns"] == ["id", "name", "color"]
        assert body["rowCount"] == 4
        assert len(body["rows"]) == 2

    async def test_out_of_range_page_returns_empty_rows(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/data",
            params={
                "db_path": rel,
                "table_name": "widgets",
                "page": 50,
                "page_size": 10,
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rows"] == []
        assert body["rowCount"] == 4

    async def test_global_filter(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/data",
            params={
                "db_path": rel,
                "table_name": "widgets",
                "page": 0,
                "page_size": 50,
                "global_filter": "red",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["rowCount"] == 2  # sprocket + lever
        returned_names = sorted(row[1] for row in body["rows"])
        assert returned_names == ["lever", "sprocket"]

    async def test_sort_desc(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/data",
            params={
                "db_path": rel,
                "table_name": "widgets",
                "page": 0,
                "page_size": 50,
                "sort_column": "name",
                "sort_direction": "desc",
            },
        )
        assert resp.status_code == 200
        names = [row[1] for row in resp.json()["rows"]]
        assert names == sorted(names, reverse=True)

    async def test_invalid_sort_direction_422(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/data",
            params={
                "db_path": rel,
                "table_name": "widgets",
                "sort_column": "name",
                "sort_direction": "BOGUS",
            },
        )
        assert resp.status_code == 422

    async def test_path_traversal_rejected(self, client, api_case, tmp_data_dir, make_sample_db):
        case_id, report_id, _rel = api_case
        outside = tmp_data_dir / "reports" / "outside2.db"
        make_sample_db(outside, schema="widgets")
        resp = await client.get(
            f"/api/db_viewer/cases/{case_id}/databases/data",
            params={
                "db_path": f"{report_id}/../outside2.db",
                "table_name": "widgets",
            },
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /databases/query
# ---------------------------------------------------------------------------
class TestExecuteQueryEndpoint:
    async def test_basic_select(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/query",
            params={"db_path": rel},
            json={"sql": "SELECT id, name FROM widgets ORDER BY id LIMIT 2"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["columns"] == ["id", "name"]
        assert body["rowCount"] == 2
        assert body["rows"][0] == [1, "sprocket"]
        assert "durationMs" in body

    async def test_multi_statement_returns_400(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/query",
            params={"db_path": rel},
            json={"sql": "SELECT 1; SELECT 2;"},
        )
        assert resp.status_code == 400

    async def test_empty_query_returns_400(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/query",
            params={"db_path": rel},
            json={"sql": "   "},
        )
        assert resp.status_code == 400

    async def test_write_attempt_returns_500(self, client, api_case):
        """
        Behavior pin: the router only maps ValueError->400 and TimeoutError->408.
        Authorizer-driven sqlite3.DatabaseError surfaces as a 500 with the
        sqlite error message in the detail.
        """
        case_id, _rid, rel = api_case
        resp = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/query",
            params={"db_path": rel},
            json={"sql": "DELETE FROM widgets"},
        )
        assert resp.status_code == 500
        # Ensure the underlying file was not actually modified.
        check = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/query",
            params={"db_path": rel},
            json={"sql": "SELECT COUNT(*) AS n FROM widgets"},
        )
        assert check.status_code == 200
        assert check.json()["rows"][0][0] == 4


# ---------------------------------------------------------------------------
# POST /databases/export
# ---------------------------------------------------------------------------
class TestExportEndpoint:
    async def test_export_csv(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/export",
            params={"db_path": rel, "format": "csv"},
            json={"sql": "SELECT id, name FROM widgets ORDER BY id"},
        )
        assert resp.status_code == 200
        # Endpoint wraps the body as {"data": "<csv text>"}
        body = resp.json()
        assert "data" in body
        csv_lines = [ln for ln in body["data"].splitlines() if ln]
        assert csv_lines[0] == "id,name"
        assert len(csv_lines) == 5  # header + 4 rows

    async def test_export_json(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/export",
            params={"db_path": rel, "format": "json"},
            json={"sql": "SELECT id, name FROM widgets ORDER BY id LIMIT 2"},
        )
        assert resp.status_code == 200
        body = resp.json()
        parsed = json.loads(body["data"])
        assert parsed == [
            {"id": 1, "name": "sprocket"},
            {"id": 2, "name": "cog"},
        ]

    async def test_export_invalid_format_422(self, client, api_case):
        case_id, _rid, rel = api_case
        resp = await client.post(
            f"/api/db_viewer/cases/{case_id}/databases/export",
            params={"db_path": rel, "format": "xml"},
            json={"sql": "SELECT 1"},
        )
        assert resp.status_code == 422
