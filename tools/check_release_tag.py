#!/usr/bin/env python3
"""Exit 1 unless GITHUB_REF is the tag for the version in coacheck/__init__.py."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def package_version(root: Path = ROOT) -> str:
    text = (root / "coacheck" / "__init__.py").read_text(encoding="utf-8")
    m = re.search(r'^__version__\s*=\s*"([^"]+)"', text, re.M)
    if not m:
        raise ValueError("no __version__ in coacheck/__init__.py")
    return m.group(1)


def check(ref: str, version: str) -> str | None:
    """None when ref is refs/tags/v<version>, otherwise the reason to refuse."""
    want = f"refs/tags/v{version}"
    if ref == want:
        return None
    return (f"refusing to publish {version} from {ref or 'an unset GITHUB_REF'}: "
            f"only {want} publishes")


def main() -> int:
    version = package_version()
    ref = os.environ.get("GITHUB_REF", "")
    reason = check(ref, version)
    if reason:
        print(reason, file=sys.stderr)
        return 1
    print(f"{ref} matches coacheck {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
