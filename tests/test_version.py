"""The version string is written in four files and they have to agree."""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

import coacheck

ROOT = Path(__file__).resolve().parent.parent


def pyproject_version(text: str) -> str | None:
    # Regex, not tomllib: tomllib needs Python 3.11 and the floor is 3.9.
    project = re.search(r"(?ms)^\[project\]\s*$(.*?)(?=^\[|\Z)", text)
    if not project:
        return None
    m = re.search(r'(?m)^version\s*=\s*"([^"]+)"\s*$', project.group(1))
    return m.group(1) if m else None


def json_version(path: Path) -> str | None:
    return json.loads(path.read_text(encoding="utf-8")).get("version")


class VersionsAgree(unittest.TestCase):
    def test_pyproject(self):
        text = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
        self.assertEqual(pyproject_version(text), coacheck.__version__)

    def test_package_json(self):
        path = ROOT / "package.json"
        if not path.exists():
            self.skipTest("package.json is not in the sdist")
        self.assertEqual(json_version(path), coacheck.__version__)

    def test_extension_manifest(self):
        path = ROOT / "extension" / "manifest.json"
        if not path.exists():
            self.skipTest("the extension is not in the sdist")
        self.assertEqual(json_version(path), coacheck.__version__)

    def test_pyproject_reader_only_looks_in_the_project_table(self):
        text = '[tool.x]\nversion = "9.9.9"\n\n[project]\nname = "x"\nversion = "1.2.3"\n'
        self.assertEqual(pyproject_version(text), "1.2.3")
        self.assertIsNone(pyproject_version('[tool.x]\nversion = "9.9.9"\n'))


if __name__ == "__main__":
    unittest.main()
