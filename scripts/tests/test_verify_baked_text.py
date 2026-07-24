"""Tests for the baked-text compliance gate (scripts/verify_baked_text.py).

Run: python -m unittest discover -s scripts/tests
These exercise the pure logic + the fail-closed verdict by injecting OCR text,
so no tesseract/Replicate/network is required.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # scripts/
import verify_baked_text as vbt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

# The disclaimer line as it must appear (short marketplace form).
DISCLAIMER = 'not affiliated with, endorsed by, or sponsored by Warp'

# A clean render: every required string present, correct case.
CLEAN_TEXT = (
    'OzBridge\n'
    'Bring Warp Oz to any IDE or agent — via MCP\n'
    'Independent project, not affiliated with, endorsed by, or sponsored by Warp.'
)

# The render that actually shipped the incident: 'affiiiated'/'endersed'/'Ide'.
GARBLED_TEXT = (
    'OzBridge\n'
    'Bring Warp Oz to any Ide or agent — via MCP\n'
    'Independent project, not affiiiated with, endersed by, or sponsored by Warp.'
)


def fake_ocr(text, backend='fake'):
    return lambda _path: (text, backend)


class NormalizationTests(unittest.TestCase):
    def test_whitespace_collapsed(self):
        self.assertEqual(vbt.normalize('a   b\n\tc', case_sensitive=True), 'a b c')

    def test_case_folded_when_insensitive(self):
        self.assertEqual(vbt.normalize('AFFILIATED', case_sensitive=False), 'affiliated')

    def test_case_preserved_when_sensitive(self):
        self.assertEqual(vbt.normalize('IDE', case_sensitive=True), 'IDE')


class CheckRequiredStringTests(unittest.TestCase):
    def test_clean_disclaimer_passes_case_insensitive(self):
        self.assertTrue(vbt.check_required_string(CLEAN_TEXT, DISCLAIMER, case_sensitive=False))

    def test_misspelled_affiliated_is_rejected(self):
        # 'affiiiated' must NOT satisfy a requirement for 'affiliated'.
        self.assertFalse(vbt.check_required_string(GARBLED_TEXT, DISCLAIMER, case_sensitive=False))
        self.assertFalse(vbt.check_required_string('...affiiiated...', 'affiliated', case_sensitive=False))

    def test_misspelled_endorsed_is_rejected(self):
        self.assertFalse(vbt.check_required_string('...endersed by...', 'endorsed', case_sensitive=False))

    def test_ide_token_case_sensitive_rejects_Ide(self):
        # The whole point of per-string case sensitivity: 'Ide' != 'IDE'.
        self.assertFalse(vbt.check_required_string('any Ide or agent', 'IDE', case_sensitive=True))
        self.assertTrue(vbt.check_required_string('any IDE or agent', 'IDE', case_sensitive=True))

    def test_prose_case_insensitive_ignores_case(self):
        self.assertTrue(vbt.check_required_string('NOT AFFILIATED WITH', 'affiliated with', case_sensitive=False))

    def test_whitespace_spanning_match(self):
        self.assertTrue(vbt.check_required_string('not   affiliated\nwith', 'affiliated with', case_sensitive=False))


OG_CARD_REQUIRED = [
    {'text': 'OzBridge', 'case_sensitive': True},
    {'text': 'IDE', 'case_sensitive': True},
    {'text': DISCLAIMER, 'case_sensitive': False},
]


class EvaluateAssetTests(unittest.TestCase):
    def test_clean_render_passes(self):
        res = vbt.evaluate_asset('og', 'x.png', OG_CARD_REQUIRED, fake_ocr(CLEAN_TEXT))
        self.assertTrue(res['compliancePass'])
        self.assertFalse(res['requiresHumanReview'])
        self.assertTrue(all(c['found'] for c in res['checks']))

    def test_garbled_render_fails_with_all_three_flagged(self):
        res = vbt.evaluate_asset('og', 'x.png', OG_CARD_REQUIRED, fake_ocr(GARBLED_TEXT))
        self.assertFalse(res['compliancePass'])
        self.assertTrue(res['requiresHumanReview'])
        missing = [c['required'] for c in res['checks'] if not c['found']]
        self.assertIn('IDE', missing)
        self.assertIn(DISCLAIMER, missing)
        # OzBridge is intact in the garbled render, so it should still be found.
        self.assertNotIn('OzBridge', missing)

    def test_ocr_unavailable_fails_closed(self):
        # The exact incident trigger: OCR cannot run. Must NOT default to pass.
        res = vbt.evaluate_asset('og', 'x.png', OG_CARD_REQUIRED, fake_ocr(None, backend='unavailable'))
        self.assertFalse(res['compliancePass'])
        self.assertTrue(res['requiresHumanReview'])
        self.assertIsNone(res['ocrText'])
        self.assertTrue(any('fail-closed' in n.lower() for n in res['notes']))

    def test_missing_image_fails_closed(self):
        res = vbt.evaluate_asset('og', 'x.png', OG_CARD_REQUIRED, fake_ocr(None, backend='file-missing'))
        self.assertFalse(res['compliancePass'])
        self.assertTrue(res['requiresHumanReview'])

    def test_ocr_text_surfaced_for_audit(self):
        res = vbt.evaluate_asset('og', 'x.png', OG_CARD_REQUIRED, fake_ocr(GARBLED_TEXT))
        self.assertEqual(res['ocrText'], GARBLED_TEXT)


class ManifestTests(unittest.TestCase):
    def test_manifest_loads_and_og_card_is_wired(self):
        assets = vbt.load_manifest(ROOT / 'scripts' / 'asset-compliance.json')
        self.assertIn('ozbridge-social-og-card', assets)
        entry = assets['ozbridge-social-og-card']
        specs = entry['requiredStrings']
        texts = {s['text']: s.get('case_sensitive', False) for s in specs}
        # Disclaimer present, prose (case-insensitive).
        self.assertIn(DISCLAIMER, texts)
        self.assertFalse(texts[DISCLAIMER])
        # IDE present and case-sensitive (so 'Ide' is rejected).
        self.assertTrue(texts.get('IDE'))

    def test_manifest_required_strings_are_substrings_of_authoritative_disclaimer(self):
        # Guard against the manifest drifting from DISCLAIMER.md.
        disclaimer_md = (ROOT / 'DISCLAIMER.md').read_text(encoding='utf-8')
        norm = vbt.normalize(disclaimer_md, case_sensitive=False)
        self.assertIn(vbt.normalize('not affiliated with, endorsed by', case_sensitive=False), norm)


if __name__ == '__main__':
    unittest.main()
