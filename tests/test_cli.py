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

    def test_bom_prefixed_file_is_decoded(self):
        # The CLI decodes with utf-8-sig, so a leading BOM doesn't swallow the
        # first field into a "not found".
        code, out, _err = _run(["parse", fixture_path("coa_bom.txt")])
        self.assertEqual(code, 0)
        self.assertIn("BOM Test BT-1", out)
        self.assertIn("99.5%", out)

    def test_absurdly_long_number_json_is_still_valid(self):
        text = "Purity: " + ("9" * 320) + "%\nNet Weight: 5 mg\n"
        with mock.patch.object(cli.sys, "stdin") as stdin:
            stdin.buffer.read.return_value = text.encode("utf-8")
            code, out, _err = _run(["parse", "--json"])
        self.assertEqual(code, 0)
        payload = json.loads(out)  # would raise on a bare Infinity token
        self.assertIsNone(payload["fields"]["purity_pct"])

    def test_oversized_stdin_input_errors_cleanly(self):
        huge = b"x" * (cli.MAX_INPUT_BYTES + 1)
        with mock.patch.object(cli.sys, "stdin") as stdin:
            stdin.buffer.read.return_value = huge
            code, _out, err = _run(["parse"])
        self.assertEqual(code, 1)
        self.assertIn("too large", err)


class ParseReconstitution(unittest.TestCase):
    """`parse --recon-water/--dose` runs the reconstitution math off the mass the
    purity block just computed, so doses per vial stops contradicting the
    shortfall printed directly above it."""

    def test_default_basis_is_the_deliverable_mass(self):
        code, out, _err = _run(
            ["parse", fixture_path("coa_clean.txt"), "--recon-water", "2", "--dose", "250"]
        )
        self.assertEqual(code, 0)
        self.assertIn("actual deliverable mass", out)
        # 5 mg labeled, 99.1% purity, 91.5% net content -> 4.5338 mg deliverable,
        # which is 18.14 doses of 250 mcg, not the 20.00 the label implies.
        self.assertIn("Doses per vial      : 18.14", out)

    def test_labeled_basis_opts_back_into_the_label_figure(self):
        code, out, _err = _run(
            ["parse", fixture_path("coa_clean.txt"), "--recon-water", "2", "--dose", "250",
             "--recon-basis", "labeled"]
        )
        self.assertEqual(code, 0)
        self.assertIn("from the labeled mass", out)
        self.assertIn("Doses per vial      : 20.00", out)

    def test_json_recon_payload(self):
        code, out, _err = _run(
            ["parse", fixture_path("coa_clean.txt"), "--recon-water", "2", "--dose", "250",
             "--json"]
        )
        self.assertEqual(code, 0)
        recon = json.loads(out)["recon"]
        self.assertEqual(recon["basis"], "actual")
        self.assertEqual(recon["labeled_mg"], 5.0)
        self.assertIsNone(recon["error"])
        self.assertAlmostEqual(recon["result"]["vial_mg"], 4.533825)
        self.assertAlmostEqual(recon["result"]["doses_per_vial"], 18.1353)

    def test_recon_key_is_null_when_not_asked_for(self):
        code, out, _err = _run(["parse", fixture_path("coa_clean.txt"), "--json"])
        self.assertEqual(code, 0)
        self.assertIsNone(json.loads(out)["recon"])

    def test_dose_in_mg_matches_the_equivalent_mcg(self):
        args = ["parse", fixture_path("coa_clean.txt"), "--recon-water", "2", "--json"]
        _c1, mg, _e1 = _run([*args, "--dose", "0.25", "--unit", "mg"])
        _c2, mcg, _e2 = _run([*args, "--dose", "250"])
        self.assertEqual(
            json.loads(mg)["recon"]["result"], json.loads(mcg)["recon"]["result"]
        )

    def test_no_deliverable_mass_says_so_instead_of_using_the_label(self):
        # coa_minimal has no mass at all, so the purity math can't run. The block
        # has to report that and point at the flag, never quietly substitute.
        code, out, _err = _run(
            ["parse", fixture_path("coa_minimal.txt"), "--recon-water", "2", "--dose", "250"]
        )
        self.assertEqual(code, 0)
        self.assertIn("Not computed:", out)
        self.assertIn("--recon-basis labeled", out)

    def test_no_deliverable_mass_json_reports_the_error(self):
        code, out, _err = _run(
            ["parse", fixture_path("coa_minimal.txt"), "--recon-water", "2", "--dose", "250",
             "--json"]
        )
        self.assertEqual(code, 0)
        recon = json.loads(out)["recon"]
        self.assertIsNone(recon["result"])
        self.assertIn("no deliverable mass", recon["error"])

    def test_water_without_dose_is_a_usage_error(self):
        with self.assertRaises(SystemExit) as cm:
            _run(["parse", fixture_path("coa_clean.txt"), "--recon-water", "2"])
        self.assertEqual(cm.exception.code, 2)

    def test_dose_without_water_is_a_usage_error(self):
        with self.assertRaises(SystemExit) as cm:
            _run(["parse", fixture_path("coa_clean.txt"), "--dose", "250"])
        self.assertEqual(cm.exception.code, 2)


class ParseFailOn(unittest.TestCase):
    """--fail-on turns a checklist result into an exit code, opt-in, on a new
    code so the documented 0/1/2 contract is unchanged for existing callers."""

    def test_default_still_exits_zero_on_a_failing_checklist(self):
        code, _out, _err = _run(["parse", fixture_path("coa_minimal.txt")])
        self.assertEqual(code, 0)

    def test_fail_mode_returns_three_on_a_fail_flag(self):
        code, _out, _err = _run(
            ["parse", fixture_path("coa_minimal.txt"), "--fail-on", "fail"]
        )
        self.assertEqual(code, 3)

    def test_fail_mode_ignores_a_warn_only_checklist(self):
        code, _out, _err = _run(
            ["parse", fixture_path("coa_low_purity.txt"), "--fail-on", "fail"]
        )
        self.assertEqual(code, 0)

    def test_warn_mode_returns_three_on_a_warn_flag(self):
        code, _out, _err = _run(
            ["parse", fixture_path("coa_low_purity.txt"), "--fail-on", "warn"]
        )
        self.assertEqual(code, 3)

    def test_warn_mode_returns_three_on_a_fail_flag_too(self):
        code, _out, _err = _run(
            ["parse", fixture_path("coa_minimal.txt"), "--fail-on", "warn"]
        )
        self.assertEqual(code, 3)

    def test_clean_document_exits_zero_in_every_mode(self):
        for mode in ("never", "warn", "fail"):
            with self.subTest(mode=mode):
                code, _out, _err = _run(
                    ["parse", fixture_path("coa_clean.txt"), "--fail-on", mode]
                )
                self.assertEqual(code, 0)

    def test_unreadable_input_still_beats_the_checklist_code(self):
        # 2 means "couldn't read the input", and that has to win over 3.
        code, _out, _err = _run(["parse", "no-such-file.txt", "--fail-on", "fail"])
        self.assertEqual(code, 2)


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
