"""Turn the dataclasses this package returns into plain dicts or JSON.

Every public result type here (ParsedCoa, PurityResult, ReconResult, Flag) is
a plain @dataclass. This is the one place that knows how to walk them -
including enum values and nested dataclasses/lists - so cli.py and report.py
don't each hand-roll their own dict-building.
"""

from __future__ import annotations

import dataclasses
import enum
import json
from typing import Any


def to_dict(obj: Any) -> Any:
    """Recursively convert a dataclass (or list/tuple/dict of them) to plain dicts."""
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return {f.name: to_dict(getattr(obj, f.name)) for f in dataclasses.fields(obj)}
    if isinstance(obj, enum.Enum):
        return obj.value
    if isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_dict(v) for v in obj]
    return obj


def to_json(obj: Any, **kwargs: Any) -> str:
    """Serialize a dataclass (or nested structure of them) straight to a JSON string."""
    kwargs.setdefault("indent", 2)
    return json.dumps(to_dict(obj), **kwargs)
