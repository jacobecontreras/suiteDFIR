"""Tests for utils.sse generators."""

from __future__ import annotations

import asyncio
import json

import pytest

from utils.sse import create_task_sse_generator, wrapped_sse_generator


def _make_task(status: str = "running", queue: asyncio.Queue | None = None) -> dict:
    return {"status": status, "queue": queue or asyncio.Queue()}


# ---------------------------------------------------------------------------
# create_task_sse_generator
# ---------------------------------------------------------------------------

class TestCreateTaskSseGenerator:
    async def test_unknown_task_yields_error_then_returns(self):
        gen = create_task_sse_generator("missing", {}, ["completed"])
        events = [e async for e in gen]
        assert len(events) == 1
        assert "event: error" in events[0]
        assert "Task not found" in events[0]

    async def test_queue_message_is_streamed(self):
        q = asyncio.Queue()
        task = _make_task("running", q)
        task_dict = {"t1": task}

        await q.put("hello")

        gen = create_task_sse_generator("t1", task_dict, ["completed"])
        # Pull one streamed event
        first = await gen.__anext__()
        assert first == "data: hello\n\n"

        # Move to terminal so it closes promptly on next iteration
        task["status"] = "completed"
        second = await gen.__anext__()
        assert "event: close" in second
        # Generator should now stop
        with pytest.raises(StopAsyncIteration):
            await gen.__anext__()

    async def test_terminal_status_with_empty_queue_yields_close(self):
        task_dict = {"x": _make_task("completed")}
        gen = create_task_sse_generator("x", task_dict, ["completed", "failed"])

        first = await gen.__anext__()
        assert "event: close" in first
        assert "Stream ended" in first
        with pytest.raises(StopAsyncIteration):
            await gen.__anext__()

    async def test_cleanup_removes_task_after_terminal(self):
        task_dict = {"x": _make_task("completed")}
        gen = create_task_sse_generator("x", task_dict, ["completed"], cleanup=True)

        # Drain
        async for _ in gen:
            pass

        assert "x" not in task_dict

    async def test_no_cleanup_leaves_task_for_ttl(self):
        task_dict = {"x": _make_task("completed")}
        gen = create_task_sse_generator(
            "x", task_dict, ["completed"], cleanup=False
        )
        async for _ in gen:
            pass

        # Task remains (TTL task scheduled but not yet fired)
        assert "x" in task_dict

    async def test_generation_id_zombie_self_terminates(self):
        """A newer SSE consumer increments _sse_gen, causing older to exit."""
        task = _make_task("running")
        task_dict = {"t": task}

        gen_old = create_task_sse_generator("t", task_dict, ["completed"])
        # Prime the old generator: it will set _sse_gen = 1 and then block on queue.
        # We can't easily await a hang, so instead simulate: bump the gen counter
        # manually BEFORE the generator starts processing.
        # The simplest deterministic test: start old, then start new (which sets
        # _sse_gen = 2), then old should self-terminate.

        # Start old generator and let it assign generation
        task["_sse_gen"] = 0  # ensure clean baseline
        # Old will set _sse_gen = 1
        # Simulate the new consumer having already taken over by bumping gen
        # AFTER old assigned it. We do this by stepping old once via a put.
        await task["queue"].put("msg1")
        first = await gen_old.__anext__()
        assert first == "data: msg1\n\n"

        # New consumer takes over
        task["_sse_gen"] = 99

        # Next iteration of old should detect generation mismatch and return
        with pytest.raises(StopAsyncIteration):
            await gen_old.__anext__()

    async def test_ttl_cleanup_deletes_after_delay(self, monkeypatch):
        """Patch _ttl_cleanup to fire immediately and verify task removal."""
        import utils.sse as sse_mod

        async def instant_ttl(task_id, td, delay=0):
            if task_id in td:
                del td[task_id]

        monkeypatch.setattr(sse_mod, "_ttl_cleanup", instant_ttl)

        task_dict = {"x": _make_task("completed")}
        gen = create_task_sse_generator(
            "x", task_dict, ["completed"], cleanup=False
        )
        async for _ in gen:
            pass

        # Yield so the create_task-scheduled cleanup can run
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        assert "x" not in task_dict


# ---------------------------------------------------------------------------
# wrapped_sse_generator
# ---------------------------------------------------------------------------

class TestWrappedSseGenerator:
    async def test_dict_items_are_json_encoded(self):
        async def src():
            yield {"a": 1, "b": "two"}
            yield {"c": [1, 2, 3]}

        out = [item async for item in wrapped_sse_generator(src())]
        assert len(out) == 2
        # First should contain JSON of dict
        assert out[0].startswith("data: ")
        assert out[0].endswith("\n\n")
        payload = out[0][len("data: "):-2]
        assert json.loads(payload) == {"a": 1, "b": "two"}
        assert json.loads(out[1][len("data: "):-2]) == {"c": [1, 2, 3]}

    async def test_list_items_are_json_encoded(self):
        async def src():
            yield [1, 2, 3]

        out = [item async for item in wrapped_sse_generator(src())]
        assert out == ["data: [1, 2, 3]\n\n"]

    async def test_string_items_pass_through_str(self):
        async def src():
            yield "hello"
            yield "world"

        out = [item async for item in wrapped_sse_generator(src())]
        assert out == ["data: hello\n\n", "data: world\n\n"]

    async def test_other_types_coerced_with_str(self):
        async def src():
            yield 42
            yield 3.14

        out = [item async for item in wrapped_sse_generator(src())]
        assert out == ["data: 42\n\n", "data: 3.14\n\n"]

    async def test_empty_generator_yields_nothing(self):
        async def src():
            if False:
                yield  # pragma: no cover

        out = [item async for item in wrapped_sse_generator(src())]
        assert out == []
