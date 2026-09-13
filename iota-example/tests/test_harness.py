"""Assembly and deterministic kernel acceptance tests."""

from __future__ import annotations

from pathlib import Path

from runtime.harness import create_harness


async def test_real_echo_adapter_round_trip() -> None:
    harness = await create_harness()
    try:
        result = await harness.run("hello")
        assert result.final_text == "echo:hello"
        assert [event.type for event in result.events] == [
            "system_init",
            "text_delta",
            "final",
        ]
        assert harness.adapter.started
        assert harness.capabilities is not None
        assert harness.capabilities.streaming
    finally:
        await harness.close()


def test_create_harness_has_one_definition() -> None:
    root = Path(__file__).resolve().parents[1]
    definitions: list[tuple[Path, int]] = []
    for path in root.rglob("*.py"):
        definitions.extend(
            (path, number)
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
            if line.startswith("async def create_harness(")
        )
    assert len(definitions) == 1
    assert definitions[0][0] == root / "runtime/harness.py"
