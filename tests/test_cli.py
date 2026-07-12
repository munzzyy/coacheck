"""CLI tests: argument parsing, output modes, and error handling."""

import contextlib
import io
import json
import unittest
from unittest import mock

from coacheck import cli
from tests._helpers import fixture_path, fixture_text


def _run(argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    return code, out.getvalue(), err.getvalue()


class ParseCommand(unittest.TestCase):
    def test_human_output_on_bundled_fixture(self):
        code, out, _err = _run(["parse", fixture_path("coa_clean.txt")])
        self.assertEqual(code, 0)
        self.assertIn("Research Compound RC-118", out)
        self.assertIn("HPLC purity", out)
        self.assertIn("Red-flag checklist", out)
        self.assertIn("CC-PURITY", out)

    def test_json_output_is_valid_and_has_expected_shape(self):
        code, out, _err = _run(["parse", fixture_path("coa_clean.txt"), "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["tool"], "coacheck")
        self.assertEqual(payload["fields"]["product_name"], "Research Compound RC-118")
        self.assertIsNotNone(payload["purity"])
        self.assertEqual(len(payload["flags"]), 7)

    def test_reads_from_stdin_when_no_file_given(self):
        text = fixture_text("coa_missing_lab.txt")
        with mock.patch.object(cli.sys, "stdin") as stdin:
            stdin.buffer.read.return_value = text.encode("utf-8")
            code, out, _err = _run(["parse"])
        self.assertEqual(code, 0)
        self.assertIn("Test Article TA-2201", out)

    def test_missing_file_errors_cleanly(self):
        code, _out, err = _run(["parse", "/no/such/coa/file.txt"])
        self.assertEqual(code, 2)
        self.assertIn("coacheck:", err)

    def test_minimal_fixture_reports_missing_purity_as_fail(self):
        code, out, _err = _run(["parse", fixture_path("coa_minimal.txt")])
        self.assertEqual(code, 0)
        self.assertIn("[FAIL] CC-PURITY", out)
        self.assertIn("Not computed", out)

    def test_implausible_net_content_fixture_reports_fail(self):
        code, out, _err = _run(["parse", fixture_path("coa_implausible_net.txt")])
        self.assertEqual(code, 0)
        self.assertIn("[FAIL] CC-NET", out)

    def test_oversized_stdin_input_errors_cleanly(self):
        huge = b"x" * (cli.MAX_INPUT_BYTES + 1)
        with mock.patch.object(cli.sys, "stdin") as stdin:
            stdin.buffer.read.return_value = huge
            code, _out, err = _run(["parse"])
        self.assertEqual(code, 1)
        self.assertIn("too large", err)


class ReconCommand(unittest.TestCase):
    def test_human_output(self):
        code, out, _err = _run(["recon", "--vial", "5", "--water", "2", "--dose", "250"])
        self.assertEqual(code, 0)
        self.assertIn("10.0 units", out)

    def test_json_output(self):
        code, out, _err = _run(["recon", "--vial", "5", "--water", "2", "--dose", "250", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertAlmostEqual(payload["recon"]["units_per_dose"], 10.0)

    def test_dose_in_mg_matches_equivalent_mcg(self):
        code_mg, out_mg, _err = _run(
            ["recon", "--vial", "5", "--water", "2", "--dose", "0.25", "--unit", "mg", "--json"]
        )
        code_mcg, out_mcg, _err2 = _run(
            ["recon", "--vial", "5", "--water", "2", "--dose", "250", "--json"]
        )
        self.assertEqual(code_mg, 0)
        self.assertEqual(code_mcg, 0)
        self.assertEqual(
            json.loads(out_mg)["recon"]["units_per_dose"],
            json.loads(out_mcg)["recon"]["units_per_dose"],
        )

    def test_invalid_args_error_cleanly(self):
        code, _out, err = _run(["recon", "--vial", "0", "--water", "2", "--dose", "250"])
        self.assertEqual(code, 1)
        self.assertIn("coacheck:", err)

    def test_dose_exceeding_vial_notes_it_in_output(self):
        code, out, _err = _run(["recon", "--vial", "1", "--water", "1", "--dose", "2000"])
        self.assertEqual(code, 0)
        self.assertIn("larger than the whole vial", out)


class TopLevel(unittest.TestCase):
    def test_version_flag(self):
        with self.assertRaises(SystemExit) as cm:
            _run(["--version"])
        self.assertEqual(cm.exception.code, 0)

    def test_no_subcommand_is_a_usage_error(self):
        with self.assertRaises(SystemExit) as cm:
            _run([])
        self.assertNotEqual(cm.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
