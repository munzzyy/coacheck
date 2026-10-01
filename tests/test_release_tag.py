"""tools/check_release_tag.py, the guard in front of the PyPI upload."""

from __future__ import annotations

import importlib.util
import io
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import coacheck

SCRIPT = Path(__file__).resolve().parent.parent / "tools" / "check_release_tag.py"


def load_script():
    spec = importlib.util.spec_from_file_location("check_release_tag", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReleaseTagCheck(unittest.TestCase):
    def setUp(self):
        self.tool = load_script()

    def test_reads_the_package_version(self):
        self.assertEqual(self.tool.package_version(), coacheck.__version__)

    def test_matching_tag_passes(self):
        self.assertIsNone(self.tool.check("refs/tags/v0.2.0", "0.2.0"))

    def test_branch_ref_is_refused(self):
        reason = self.tool.check("refs/heads/main", "0.2.0")
        self.assertIn("refs/tags/v0.2.0", reason)
        self.assertIn("refs/heads/main", reason)

    def test_tag_for_another_version_is_refused(self):
        self.assertIsNotNone(self.tool.check("refs/tags/v0.1.0", "0.2.0"))

    def test_tag_without_the_v_is_refused(self):
        self.assertIsNotNone(self.tool.check("refs/tags/0.2.0", "0.2.0"))

    def test_lookalike_tags_are_refused(self):
        for ref in ("refs/tags/v0.2.0rc1", "refs/tags/v0.2.0/x", "refs/heads/v0.2.0", " refs/tags/v0.2.0"):
            with self.subTest(ref=ref):
                self.assertIsNotNone(self.tool.check(ref, "0.2.0"))

    def test_unset_ref_is_refused(self):
        self.assertIn("unset", self.tool.check("", "0.2.0"))

    def test_main_exit_codes(self):
        good = f"refs/tags/v{coacheck.__version__}"
        for ref, want in ((good, 0), ("refs/heads/main", 1), (None, 1)):
            env = {k: v for k, v in os.environ.items() if k != "GITHUB_REF"}
            if ref is not None:
                env["GITHUB_REF"] = ref
            with self.subTest(ref=ref), mock.patch.dict(os.environ, env, clear=True):
                out, err = io.StringIO(), io.StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    code = self.tool.main()
                self.assertEqual(code, want)
                self.assertEqual(bool(err.getvalue()), want == 1)


if __name__ == "__main__":
    unittest.main()
