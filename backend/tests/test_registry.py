"""Guards that keep the shared registry honest."""
import json
from pathlib import Path

from app.config import Settings

ROOT = Path(__file__).resolve().parents[2]
REG = json.loads(Settings().registry_path.read_text())


def test_every_referenced_test_file_exists():
    for tool in REG["tools"]:
        assert tool["tests"], tool["id"]
        for ref in tool["tests"]:
            assert (ROOT / ref).is_file(), f"{tool['id']} references missing test {ref}"


def test_targets_and_inputs_reference_known_formats_and_options():
    for tool in REG["tools"]:
        for f in tool["inputs"]:
            assert f == "*" or f in REG["formats"], (tool["id"], f)
        for t in tool["targets"]:
            assert t["format"] in REG["formats"]
            assert set(t.get("from", [])) <= set(tool["inputs"])
            assert set(t["options"]) <= set(REG["optionDefs"])


def test_formats_doc_is_in_sync_with_registry():
    doc = (ROOT / "docs" / "FORMATS.md").read_text()
    for tool in REG["tools"]:
        assert f"| {tool['name']}" in doc, f"docs/FORMATS.md is stale; run `pnpm docs:formats` ({tool['id']})"
