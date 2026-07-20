"""Tests for the pure parts of utils.helpers."""

from __future__ import annotations

import os
import platform

import pytest
from fastapi import HTTPException

import utils.helpers as helpers
from utils.helpers import (
    get_size_format,
    get_subprocess_startupinfo,
    handle_open_path_request,
    open_path_secured,
)


# ---------------------------------------------------------------------------
# get_size_format
# ---------------------------------------------------------------------------

class TestGetSizeFormat:
    def test_bytes_under_1k(self):
        assert get_size_format(0) == "0.00B"
        assert get_size_format(512) == "512.00B"

    def test_kilobytes(self):
        assert get_size_format(1024) == "1.00KB"
        assert get_size_format(1536) == "1.50KB"

    def test_megabytes(self):
        assert get_size_format(1024 * 1024) == "1.00MB"

    def test_gigabytes(self):
        assert get_size_format(1024 ** 3) == "1.00GB"

    def test_terabytes(self):
        assert get_size_format(1024 ** 4) == "1.00TB"

    def test_custom_factor_1000(self):
        # 1000 factor => SI-style (still uses K/M letters)
        out = get_size_format(1000, factor=1000)
        assert out == "1.00KB"

    def test_custom_suffix(self):
        out = get_size_format(2048, suffix="b")
        assert out == "2.00Kb"


# ---------------------------------------------------------------------------
# open_path_secured
# ---------------------------------------------------------------------------

class TestOpenPathSecured:
    def test_access_denied_outside_allowed_dir(self, tmp_path, monkeypatch):
        # Path is outside allowed_dir
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        outside = tmp_path / "outside"
        outside.mkdir()

        called = {"count": 0}
        monkeypatch.setattr(
            helpers, "open_in_explorer", lambda p: called.__setitem__("count", called["count"] + 1)
        )

        result = open_path_secured(str(outside), str(allowed), "Report")
        assert result == {"error": "Access denied", "status_code": 403}
        assert called["count"] == 0

    def test_not_found_inside_allowed_dir(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        missing = allowed / "missing.txt"

        monkeypatch.setattr(helpers, "open_in_explorer", lambda p: None)

        result = open_path_secured(str(missing), str(allowed), "Backup")
        assert result["status_code"] == 404
        assert "not found" in result["error"]

    def test_success_invokes_open_in_explorer(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        target = allowed / "file.txt"
        target.write_text("hi")

        captured = {}

        def fake_open(p):
            captured["path"] = p

        monkeypatch.setattr(helpers, "open_in_explorer", fake_open)

        result = open_path_secured(str(target), str(allowed), "Report")
        assert result["success"] is True
        assert "Report opened" in result["message"]
        assert captured["path"] == str(target)

    def test_open_exception_returns_500(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        target = allowed / "file.txt"
        target.write_text("hi")

        def boom(_p):
            raise RuntimeError("explode")

        monkeypatch.setattr(helpers, "open_in_explorer", boom)

        result = open_path_secured(str(target), str(allowed), "Report")
        assert result["status_code"] == 500
        assert "Failed to open report" in result["error"]
        assert "explode" in result["error"]


# ---------------------------------------------------------------------------
# handle_open_path_request
# ---------------------------------------------------------------------------

class TestHandleOpenPathRequest:
    def test_raises_http_exception_on_error(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        outside = tmp_path / "elsewhere"
        outside.mkdir()

        monkeypatch.setattr(helpers, "open_in_explorer", lambda p: None)

        with pytest.raises(HTTPException) as ei:
            handle_open_path_request(str(outside), str(allowed), "Report")
        assert ei.value.status_code == 403

    def test_returns_message_on_success(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        target = allowed / "x.txt"
        target.write_text("ok")

        monkeypatch.setattr(helpers, "open_in_explorer", lambda p: None)

        result = handle_open_path_request(str(target), str(allowed), "Backup")
        assert result == {"message": "Backup opened successfully"}

    def test_404_when_missing(self, tmp_path, monkeypatch):
        allowed = tmp_path / "allowed"
        allowed.mkdir()
        monkeypatch.setattr(helpers, "open_in_explorer", lambda p: None)

        with pytest.raises(HTTPException) as ei:
            handle_open_path_request(str(allowed / "missing"), str(allowed), "Backup")
        assert ei.value.status_code == 404


# ---------------------------------------------------------------------------
# get_subprocess_startupinfo
# ---------------------------------------------------------------------------

class TestGetSubprocessStartupinfo:
    def test_returns_none_on_non_windows(self, monkeypatch):
        monkeypatch.setattr(helpers.platform, "system", lambda: "Darwin")
        assert get_subprocess_startupinfo() is None

        monkeypatch.setattr(helpers.platform, "system", lambda: "Linux")
        assert get_subprocess_startupinfo() is None

    def test_returns_startupinfo_on_windows(self, monkeypatch):
        """On non-Windows hosts subprocess.STARTUPINFO is not defined, so we
        stub the subprocess module attributes minimally."""
        import subprocess as sp

        class FakeStartup:
            def __init__(self):
                self.dwFlags = 0
                self.wShowWindow = 0

        monkeypatch.setattr(helpers.platform, "system", lambda: "Windows")
        monkeypatch.setattr(sp, "STARTUPINFO", FakeStartup, raising=False)
        monkeypatch.setattr(sp, "STARTF_USESHOWWINDOW", 1, raising=False)
        monkeypatch.setattr(sp, "SW_HIDE", 0, raising=False)

        info = get_subprocess_startupinfo()
        assert isinstance(info, FakeStartup)
        assert info.dwFlags & 1  # STARTF_USESHOWWINDOW set


# ---------------------------------------------------------------------------
# get_binary_path
# ---------------------------------------------------------------------------

class TestGetBinaryPath:
    """Resolution against the real repo bin/ tree (both Linux arch dirs are
    checked in), with platform/machine pinned so results don't depend on the
    host running the tests."""

    BINARIES = ["adb", "idevice_id", "ideviceinfo", "idevicepair", "idevicebackup2"]

    def test_linux_x86_64_layout(self, monkeypatch):
        monkeypatch.setattr(helpers.platform, "system", lambda: "Linux")
        monkeypatch.setattr(helpers.platform, "machine", lambda: "x86_64")
        for name in self.BINARIES:
            path = helpers.get_binary_path(name)
            assert path.endswith(f"bin/linux/x86_64/{name}".replace("/", os.sep))

    def test_linux_arm64_layout(self, monkeypatch):
        monkeypatch.setattr(helpers.platform, "system", lambda: "Linux")
        monkeypatch.setattr(helpers.platform, "machine", lambda: "aarch64")
        for name in self.BINARIES:
            path = helpers.get_binary_path(name)
            assert path.endswith(f"bin/linux/arm64/{name}".replace("/", os.sep))

    def test_linux_amd64_alias_maps_to_x86_64(self, monkeypatch):
        monkeypatch.setattr(helpers.platform, "system", lambda: "Linux")
        monkeypatch.setattr(helpers.platform, "machine", lambda: "amd64")
        assert "x86_64" in helpers.get_binary_path("idevice_id")

    def test_missing_binary_raises_not_bare_name(self, monkeypatch):
        monkeypatch.setattr(helpers.platform, "system", lambda: "Linux")
        monkeypatch.setattr(helpers.platform, "machine", lambda: "x86_64")
        with pytest.raises(FileNotFoundError):
            helpers.get_binary_path("definitely_not_a_bundled_tool")

    def test_unknown_linux_arch_raises(self, monkeypatch):
        monkeypatch.setattr(helpers.platform, "system", lambda: "Linux")
        monkeypatch.setattr(helpers.platform, "machine", lambda: "riscv64")
        with pytest.raises(FileNotFoundError):
            helpers.get_binary_path("idevice_id")

    def test_unsupported_platform_raises(self, monkeypatch):
        monkeypatch.setattr(helpers.platform, "system", lambda: "FreeBSD")
        with pytest.raises(FileNotFoundError):
            helpers.get_binary_path("idevice_id")
