"""Tests for utils.fs_ops.FileOperations."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from utils.fs_ops import FileOperations


# ---------------------------------------------------------------------------
# delete_path
# ---------------------------------------------------------------------------

class TestDeletePath:
    async def test_delete_file(self, tmp_path):
        f = tmp_path / "a.txt"
        f.write_text("hello")
        assert f.exists()

        await FileOperations.delete_path(f)
        assert not f.exists()

    async def test_delete_directory_recursively(self, tmp_path):
        d = tmp_path / "dir"
        (d / "nested").mkdir(parents=True)
        (d / "nested" / "inside.txt").write_text("inside")
        (d / "top.txt").write_text("top")

        await FileOperations.delete_path(d)
        assert not d.exists()

    async def test_delete_accepts_str_path(self, tmp_path):
        f = tmp_path / "b.txt"
        f.write_text("data")

        await FileOperations.delete_path(str(f))
        assert not f.exists()


# ---------------------------------------------------------------------------
# calc_directory_size
# ---------------------------------------------------------------------------

class TestCalcDirectorySize:
    async def test_single_file_returns_its_size(self, tmp_path):
        f = tmp_path / "x.bin"
        f.write_bytes(b"x" * 1234)
        size = await FileOperations.calc_directory_size(f)
        assert size == 1234

    async def test_directory_sums_all_files(self, tmp_path):
        (tmp_path / "a.bin").write_bytes(b"a" * 100)
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "b.bin").write_bytes(b"b" * 50)
        (sub / "c.bin").write_bytes(b"c" * 25)

        size = await FileOperations.calc_directory_size(tmp_path)
        assert size == 175

    async def test_empty_directory_returns_zero(self, tmp_path):
        empty = tmp_path / "empty"
        empty.mkdir()
        size = await FileOperations.calc_directory_size(empty)
        assert size == 0


# ---------------------------------------------------------------------------
# calc_directory_stats
# ---------------------------------------------------------------------------

class TestCalcDirectoryStats:
    async def test_single_file(self, tmp_path):
        f = tmp_path / "x.bin"
        f.write_bytes(b"x" * 10)
        stats = await FileOperations.calc_directory_stats(f)
        assert stats == {"size": 10, "file_count": 1}

    async def test_directory_counts_files_and_size(self, tmp_path):
        (tmp_path / "a").write_bytes(b"x" * 5)
        nested = tmp_path / "n"
        nested.mkdir()
        (nested / "b").write_bytes(b"y" * 7)
        (nested / "c").write_bytes(b"z" * 3)

        stats = await FileOperations.calc_directory_stats(tmp_path)
        assert stats["file_count"] == 3
        assert stats["size"] == 15

    async def test_empty_directory(self, tmp_path):
        d = tmp_path / "empty"
        d.mkdir()
        stats = await FileOperations.calc_directory_stats(d)
        assert stats == {"size": 0, "file_count": 0}


# ---------------------------------------------------------------------------
# cleanup_empty_dirs (NOT recursive; does not delete root or direct child)
# ---------------------------------------------------------------------------

class TestCleanupEmptyDirs:
    async def test_deletes_empty_grandchild(self, tmp_path):
        # tmp_path = root, tmp_path/child = direct child, child/grandchild = removable
        child = tmp_path / "child"
        gc = child / "grandchild"
        gc.mkdir(parents=True)

        await FileOperations.cleanup_empty_dirs({gc}, tmp_path)
        assert not gc.exists()
        # Direct child must still exist
        assert child.exists()

    async def test_does_not_delete_root_or_direct_child(self, tmp_path):
        child = tmp_path / "child"
        child.mkdir()

        await FileOperations.cleanup_empty_dirs({tmp_path, child}, tmp_path)
        # Both should remain
        assert tmp_path.exists()
        assert child.exists()

    async def test_does_not_delete_nonempty_grandchild(self, tmp_path):
        gc = tmp_path / "child" / "grandchild"
        gc.mkdir(parents=True)
        (gc / "keep.txt").write_text("keep me")

        await FileOperations.cleanup_empty_dirs({gc}, tmp_path)
        assert gc.exists()
        assert (gc / "keep.txt").exists()

    async def test_ignores_ds_store_when_checking_empty(self, tmp_path):
        gc = tmp_path / "child" / "grandchild"
        gc.mkdir(parents=True)
        (gc / ".DS_Store").write_text("metadata")

        await FileOperations.cleanup_empty_dirs({gc}, tmp_path)
        # DS_Store-only dir is treated as empty and removed
        assert not gc.exists()

    async def test_missing_path_is_skipped(self, tmp_path):
        # Should not raise
        await FileOperations.cleanup_empty_dirs(
            {tmp_path / "does-not-exist"}, tmp_path
        )


# ---------------------------------------------------------------------------
# cleanup_empty_dirs_recursive (walks upward to root)
# ---------------------------------------------------------------------------

class TestCleanupEmptyDirsRecursive:
    async def test_walks_up_until_root(self, tmp_path):
        deep = tmp_path / "a" / "b" / "c"
        deep.mkdir(parents=True)

        await FileOperations.cleanup_empty_dirs_recursive({deep}, tmp_path)

        assert not deep.exists()
        assert not (tmp_path / "a" / "b").exists()
        assert not (tmp_path / "a").exists()
        # root must remain
        assert tmp_path.exists()

    async def test_stops_at_nonempty_dir(self, tmp_path):
        deep = tmp_path / "a" / "b" / "c"
        deep.mkdir(parents=True)
        # Place a sibling file so /a is not empty after /a/b/c removed
        (tmp_path / "a" / "keep.txt").write_text("keep")

        await FileOperations.cleanup_empty_dirs_recursive({deep}, tmp_path)

        assert not deep.exists()
        assert not (tmp_path / "a" / "b").exists()
        # /a kept because of keep.txt sibling
        assert (tmp_path / "a").exists()

    async def test_ignores_ds_store_in_walk(self, tmp_path):
        deep = tmp_path / "a" / "b"
        deep.mkdir(parents=True)
        (deep / ".DS_Store").write_text("m")
        (deep.parent / ".DS_Store").write_text("m")

        await FileOperations.cleanup_empty_dirs_recursive({deep}, tmp_path)

        assert not deep.exists()
        assert not (tmp_path / "a").exists()


# ---------------------------------------------------------------------------
# validate_path_security
# ---------------------------------------------------------------------------

class TestValidatePathSecurity:
    def test_accepts_path_inside_allowed(self, tmp_path):
        target = tmp_path / "nested" / "file.txt"
        target.parent.mkdir(parents=True)
        target.write_text("ok")
        assert FileOperations.validate_path_security(target, tmp_path) is True

    def test_rejects_path_outside_allowed(self, tmp_path):
        outside = tmp_path.parent / "elsewhere"
        # Even if the outside path doesn't exist, resolution will still place it
        # outside `tmp_path` and the function should return False.
        assert FileOperations.validate_path_security(outside, tmp_path) is False

    def test_rejects_traversal(self, tmp_path):
        sneaky = tmp_path / "sub" / ".." / ".." / "etc"
        assert FileOperations.validate_path_security(sneaky, tmp_path) is False

    def test_accepts_allowed_dir_itself(self, tmp_path):
        assert FileOperations.validate_path_security(tmp_path, tmp_path) is True

    def test_is_path_within_allowed_alias(self, tmp_path):
        assert FileOperations.is_path_within_allowed(tmp_path, tmp_path) is True
