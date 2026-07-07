"""
Shared pytest fixtures for the suiteDFIR backend test suite.

This conftest does several critical things BEFORE any application module
is imported, because:
  * `core/config.py` computes BASE_DIR / DB_PATH / REPORTS_DIR / etc. at
    import time from the project root.
  * Services & API routers `from core.config import DB_PATH` (binding the
    value into their own namespace), so patching `core.config.DB_PATH`
    after the fact is not enough.
  * `core/crypto.py` lazily fetches a master key from the system keychain;
    we replace that with an in-memory Fernet key for tests.

Strategy:
  1. Inject `backend/src` onto sys.path so `from core.x import y` works
     identically to the live app.
  2. Create a per-session temp directory and rewrite the path constants
     in `core.config` BEFORE any other module imports them.
  3. Stub `core.crypto._get_fernet` with a deterministic Fernet instance.
  4. Provide reusable fixtures: clean DB per test, FastAPI TestClient,
     async httpx AsyncClient, and a sample-case helper.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import AsyncIterator, Callable, Iterator

import pytest

# ---------------------------------------------------------------------------
# 1. Make `from core.x import y` resolve to backend/src/core/...
# ---------------------------------------------------------------------------
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_SRC_DIR = _BACKEND_DIR / "src"
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

# ---------------------------------------------------------------------------
# 2. Per-session temp dir + rewrite of config path constants.
#
#    Done at collection time (module import) so any test module that does
#    `from core.config import DB_PATH` (or transitively triggers it via a
#    service import) sees the test paths, never the real user data dir.
# ---------------------------------------------------------------------------
_SESSION_TMP = Path(tempfile.mkdtemp(prefix="suitedfir-tests-"))
(_SESSION_TMP / "data").mkdir(parents=True, exist_ok=True)
(_SESSION_TMP / "reports").mkdir(parents=True, exist_ok=True)
(_SESSION_TMP / "backups").mkdir(parents=True, exist_ok=True)
(_SESSION_TMP / "data" / "photos").mkdir(parents=True, exist_ok=True)
(_SESSION_TMP / "data" / "imports").mkdir(parents=True, exist_ok=True)
(_SESSION_TMP / "data" / "cache").mkdir(parents=True, exist_ok=True)

import core.config as _config  # noqa: E402

_config.BASE_DIR = _SESSION_TMP
_config.DATA_DIR = str(_SESSION_TMP / "data")
_config.DB_PATH = str(_SESSION_TMP / "data" / "app.db")
_config.REPORTS_DIR = str(_SESSION_TMP / "reports")
_config.BACKUPS_DIR = str(_SESSION_TMP / "backups")
_config.PHOTOS_DIR = str(_SESSION_TMP / "data" / "photos")
_config.CACHE_DIR = _SESSION_TMP / "data" / "cache"
_config.COORDS_DB = str(_SESSION_TMP / "data" / "cache" / "coordinates.db")

# ---------------------------------------------------------------------------
# 3. Stub crypto so tests do not touch the OS keychain.
# ---------------------------------------------------------------------------
import core.crypto as _crypto  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402

_TEST_KEY = Fernet.generate_key()
_TEST_FERNET = Fernet(_TEST_KEY)
_crypto._fernet = _TEST_FERNET  # bypass MasterKeyStore entirely


# ---------------------------------------------------------------------------
# 4. Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture
def tmp_data_dir() -> Path:
    """The session temp directory rooting all redirected paths."""
    return _SESSION_TMP


@pytest.fixture
def fresh_db() -> Iterator[str]:
    """
    Recreate the SQLite database for the current test.

    Each test gets a pristine schema with no rows. We re-import the
    database module's view of DB_PATH because services use `from core.config
    import DB_PATH` which captures the value at their own import time —
    however `core.database` itself uses `from core.config import DB_PATH`,
    and that binding was set BEFORE the import (see top of file), so it
    correctly points at the session temp dir.
    """
    from core.database import DB_PATH, init_database

    db_file = Path(DB_PATH)
    if db_file.exists():
        db_file.unlink()
    # Also clean WAL/SHM siblings if a prior test left them behind.
    for ext in ("-wal", "-shm"):
        sibling = db_file.with_name(db_file.name + ext)
        if sibling.exists():
            sibling.unlink()

    init_database()
    yield str(db_file)


@pytest.fixture(autouse=True)
def _reset_singletons() -> Iterator[None]:
    yield
    try:
        from services import db_viewer_manager as _dbv_mod
        try:
            _dbv_mod.db_viewer_manager.close_all()
        except Exception:
            pass
        _dbv_mod.db_viewer_manager._case_report_paths.clear()
    except Exception:
        pass

    try:
        from services.photos_manager import PhotosManager, photos_manager
        PhotosManager._file_ext_cache.clear()
        photos_manager._manifest_cache.clear()
        photos_manager._extraction_cache.clear()
    except Exception:
        pass

    try:
        from services import tile_manager as _tile_mod
        _tile_mod.tile_manager._geocode_request_times.clear()
        _tile_mod.tile_manager._autocomplete_request_times.clear()
    except Exception:
        pass


@pytest.fixture
def make_sample_db() -> Callable[..., None]:
    def _make(path: Path, schema: str = "users_posts") -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            path.unlink()
        conn = sqlite3.connect(path)
        try:
            if schema == "users_posts":
                conn.executescript(
                    """
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        email TEXT
                    );
                    CREATE INDEX idx_users_email ON users(email);

                    CREATE TABLE posts (
                        id INTEGER PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        title TEXT,
                        FOREIGN KEY(user_id) REFERENCES users(id)
                    );

                    CREATE VIEW user_post_counts AS
                        SELECT u.id, u.name, COUNT(p.id) AS post_count
                        FROM users u LEFT JOIN posts p ON p.user_id = u.id
                        GROUP BY u.id;

                    CREATE TRIGGER trg_users_noop
                    AFTER INSERT ON users
                    BEGIN
                        SELECT 1;
                    END;

                    INSERT INTO users (id, name, email) VALUES
                        (1, 'Alice', 'alice@example.com'),
                        (2, 'Bob',   'bob@example.com'),
                        (3, 'Carol', 'carol@elsewhere.org');

                    INSERT INTO posts (id, user_id, title) VALUES
                        (1, 1, 'Hello World'),
                        (2, 1, 'Second Post'),
                        (3, 2, 'Bob speaks');
                    """
                )
            elif schema == "widgets":
                conn.executescript(
                    """
                    CREATE TABLE widgets (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        color TEXT
                    );
                    INSERT INTO widgets (id, name, color) VALUES
                        (1, 'sprocket', 'red'),
                        (2, 'cog',      'blue'),
                        (3, 'gear',     'green'),
                        (4, 'lever',    'red');
                    """
                )
            else:
                raise ValueError(f"unknown schema: {schema!r}")
            conn.commit()
        finally:
            conn.close()

    return _make


@pytest.fixture
def test_app(fresh_db):
    """
    Build a FastAPI app with all routers but WITHOUT the production
    lifespan (no plugin loading, no device watcher, no orphan-sweep task).
    Returns a fresh app per test so router state is isolated.
    """
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    from api import (
        backups,
        case_exports,
        cases,
        dashboard,
        db_viewer,
        photos,
        processing,
        profiles,
        reports,
        settings,
        system,
        tiles,
        tools,
    )

    app = FastAPI()

    @app.exception_handler(Exception)
    async def _handler(request, exc):
        from fastapi import HTTPException
        from starlette.exceptions import HTTPException as StarletteHTTPException

        if isinstance(exc, (HTTPException, StarletteHTTPException)):
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        return JSONResponse(status_code=500, content={"detail": f"Internal Server Error: {exc}"})

    for router_mod in (
        system, cases, reports, profiles, dashboard, processing, backups,
        tools, settings, tiles, db_viewer, case_exports, photos,
    ):
        app.include_router(router_mod.router)

    return app


@pytest.fixture
async def client(test_app) -> AsyncIterator:
    """
    Async httpx client wired to the FastAPI app via ASGITransport.

    Note: this is async because the synchronous `fastapi.testclient.TestClient`
    is incompatible with httpx >= 0.28 in FastAPI 0.104. Tests should be
    `async def` and `await` requests, e.g. `resp = await client.get(...)`.
    """
    import httpx
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


# Alias for clarity in tests that want to be explicit.
@pytest.fixture
async def async_client(client):
    yield client


@pytest.fixture
async def sample_case(fresh_db) -> dict:
    """Insert a sample case directly via the service layer; return the row."""
    from services.case_manager import case_manager

    case_id = await case_manager.create_case({
        "name": "Sample Case",
        "case_number": "C-001",
        "client_name": "Acme",
        "client_phone": "+1-555-0100",
        "client_email": "acme@example.com",
        "description": "A test case",
        "status": "Active",
        "priority": "Medium",
    })
    return await case_manager.get_case(case_id)
