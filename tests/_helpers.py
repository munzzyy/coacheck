"""Shared test helpers."""

from __future__ import annotations

from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def fixture_path(name: str) -> str:
    return str(FIXTURES / name)


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")
