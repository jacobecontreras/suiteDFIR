"""Security-config tests for the app entry point (main.py).

Covers the hardening from commit bb6ddfb: CORS is locked to the Electron
app's real origins (app:// in prod, the Vite dev server in dev) with
credentials disabled. The loopback bind (BIND_HOST = "127.0.0.1") lives
inside the ``__main__`` guard and is passed straight to ``uvicorn.run``,
so it is a literal constant verified by inspection rather than exercised here.
"""

from __future__ import annotations

import importlib

import httpx


def _load_main(monkeypatch, *, dev: bool):
    """(Re)import ``src/main`` with SUITEDFIR_DEV set, returning the module.

    ``IS_DEV`` and ``_allowed_origins`` are computed at import time, so each
    test reloads the module under the env it wants to assert against.
    """
    monkeypatch.setenv("SUITEDFIR_DEV", "true" if dev else "false")
    import main

    return importlib.reload(main)


def test_allowed_origins_prod(monkeypatch):
    main = _load_main(monkeypatch, dev=False)
    assert main._allowed_origins == ["app://."]


def test_allowed_origins_dev(monkeypatch):
    main = _load_main(monkeypatch, dev=True)
    assert main._allowed_origins == ["http://localhost:3000"]


async def test_cors_rejects_disallowed_origin(monkeypatch):
    """A preflight from an unlisted origin must not receive an allow-origin."""
    main = _load_main(monkeypatch, dev=False)
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.options(
            "/api/health",
            headers={
                "Origin": "https://evil.example.com",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert resp.status_code == 400
    assert "access-control-allow-origin" not in resp.headers


async def test_cors_allows_configured_origin(monkeypatch):
    """The configured origin is echoed back, and credentials stay disabled."""
    main = _load_main(monkeypatch, dev=False)
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.options(
            "/api/health",
            headers={
                "Origin": "app://.",
                "Access-Control-Request-Method": "GET",
            },
        )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "app://."
    # Hardening: credentials must remain off.
    assert "access-control-allow-credentials" not in resp.headers
