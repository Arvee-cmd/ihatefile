"""Loads shared/registry.json - the single source of truth for supported conversions."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import ApiError, bad_request

# Longest first so "tar.gz" wins over "gz".
_COMPOUND_EXT = ("tar.gz",)


@dataclass(frozen=True)
class Registry:
    raw: dict[str, Any]

    @property
    def formats(self) -> dict[str, dict]:
        return self.raw["formats"]

    @property
    def option_defs(self) -> dict[str, dict]:
        return self.raw["optionDefs"]

    @property
    def tools(self) -> list[dict]:
        return self.raw["tools"]

    def server_tools(self) -> list[dict]:
        return [t for t in self.tools if t["mode"] == "server"]

    def tool(self, tool_id: str) -> dict:
        for t in self.tools:
            if t["id"] == tool_id and t["mode"] == "server":
                return t
        raise bad_request(f"Unknown server tool {tool_id!r}", "unknown_tool")

    def format_from_filename(self, filename: str) -> str | None:
        name = filename.lower()
        exts = {e: fid for fid, f in self.formats.items() for e in f["extensions"]}
        for compound in _COMPOUND_EXT:
            if name.endswith("." + compound):
                return exts.get(compound)
        if "." not in name:
            return None
        return exts.get(name.rsplit(".", 1)[1])

    def resolve(self, tool_id: str, target_id: str, input_format: str) -> tuple[dict, dict]:
        """Validate (tool, input format, target) against the registry; returns (tool, target)."""
        tool = self.tool(tool_id)
        target = next((t for t in tool["targets"] if t["id"] == target_id), None)
        if target is None:
            raise bad_request(f"Tool {tool_id!r} has no target {target_id!r}", "unsupported_target")
        if input_format not in tool["inputs"] or input_format not in target.get("from", tool["inputs"]):
            raise ApiError(
                415,
                "unsupported_conversion",
                f"{self.formats[input_format]['label']} cannot be converted to "
                f"{self.formats[target['format']]['label']} with {tool['name']}.",
            )
        if input_format == target["format"] and not tool.get("allowSameFormat"):
            raise bad_request("Input and output formats are the same.", "same_format")
        return tool, target

    def validate_options(self, target: dict, supplied: dict[str, Any]) -> dict[str, Any]:
        """Returns the full option dict (defaults filled in); rejects unknown or invalid values."""
        allowed = target.get("options", [])
        unknown = set(supplied) - set(allowed)
        if unknown:
            raise bad_request(f"Unsupported option(s) for this conversion: {', '.join(sorted(unknown))}", "bad_option")
        out: dict[str, Any] = {}
        for name in allowed:
            d = self.option_defs[name]
            value = supplied.get(name, d["default"])
            kind = d["type"]
            try:
                if kind in ("range", "number"):
                    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                        raise ValueError
                    value = float(value)
                    if not (d["min"] <= value <= d["max"]):
                        raise ValueError
                    value = int(value)
                elif kind == "select":
                    value = str(value)
                    if value not in [c["value"] for c in d["choices"]]:
                        raise ValueError
                elif kind == "boolean":
                    if not isinstance(value, bool):
                        raise ValueError
                elif kind == "color":
                    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
                        raise ValueError
                elif kind == "text":
                    if not isinstance(value, str) or len(value) > 200:
                        raise ValueError
            except ValueError:
                raise bad_request(f"Invalid value for option {name!r}.", "bad_option") from None
            out[name] = value
        return out


def load_registry(path: Path) -> Registry:
    with open(path, encoding="utf-8") as fh:
        return Registry(json.load(fh))
