from __future__ import annotations

# ---------------------------------------------------------------------------
# verify_baked_text.py — fail-closed text-verification gate for baked-in strings
# ---------------------------------------------------------------------------
#
# WHY THIS EXISTS
# ---------------
# Some OzBridge promotional assets bake required text directly into the rendered
# pixels (product name, tagline, and the legally-required independence disclaimer).
# When such an asset is produced by an AI image model (e.g. an ad-hoc Replicate /
# ideogram run), the model can *hallucinate letters*: a real incident shipped a
# social card whose disclaimer rendered "affiiiated"/"endersed" instead of the
# verbatim "affiliated"/"endorsed", and whose tagline rendered "Ide" instead of
# "IDE". The generation step "self-assessed" compliance and set compliancePass=true
# without ever reading the rendered pixels — and when its bundled vision models all
# returned 404 it *fell back to pass* instead of failing.
#
# This module is the gate that must run AFTER any such generation, on the rendered
# PNG, BEFORE the asset is considered shippable.
#
# HARD RULES (fail closed)
# ------------------------
#   1. Every required string in the asset's brief must be present in the OCR'd
#      pixels, character-for-character (after whitespace/optional-case normalize).
#   2. If OCR is UNAVAILABLE (no local tesseract and no working Replicate OCR
#      backend) the verdict is compliancePass = FALSE and the asset is flagged for
#      human review. We NEVER default to pass when we could not read the pixels.
#   3. The OCR'd text is surfaced in the result for audit.
#
# This is intentionally decoupled from how the image was produced — the repo's
# committed pipeline (scripts/generate_media.py + the Playwright renders) draws
# deterministic, literal text and does not need this gate, but any AI-generated
# asset with baked-in required strings does.
#
# USAGE
# -----
#   # Verify an asset declared in scripts/asset-compliance.json:
#   python scripts/verify_baked_text.py --asset ozbridge-social-og-card
#
#   # Verify every asset in the manifest:
#   python scripts/verify_baked_text.py --all
#
#   # Ad-hoc verification of an arbitrary PNG:
#   python scripts/verify_baked_text.py --image media/card.png \
#       --require "not affiliated with, endorsed by, or sponsored by Warp" \
#       --require-exact "IDE" --require-exact "OzBridge"
#
# OCR backends (tried in order; first that works wins):
#   1. local tesseract via pytesseract  (pip install pytesseract + install the
#      tesseract binary)
#   2. a Replicate OCR model            (set REPLICATE_API_TOKEN; override the
#      model with --replicate-ocr-model or REPLICATE_OCR_MODEL)
#
# Exit code: 0 only when every evaluated asset passed. 1 otherwise (failure,
# missing image, or OCR unavailable). Designed to gate CI / release steps.

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Callable, Optional

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / 'scripts' / 'asset-compliance.json'
DEFAULT_REPLICATE_OCR_MODEL = os.environ.get('REPLICATE_OCR_MODEL', 'abiruyt/text-extract-ocr')

# An OCR function takes an image path and returns (text, backend_label).
# text is None when OCR could not be performed (-> fail closed).
OcrFn = Callable[[Path], 'tuple[Optional[str], str]']


# ---------------------------------------------------------------------------
# String normalization + assertion (pure, fully unit-testable without OCR)
# ---------------------------------------------------------------------------

_WS_RE = re.compile(r'\s+')
_ZERO_WIDTH = '​‌‍﻿'


def normalize(text: str, case_sensitive: bool) -> str:
    """Collapse all whitespace runs to a single space and trim. When
    case_sensitive is False, also case-fold so prose comparisons ignore case.

    Case-folding is deliberately *opt-out per string*: prose like the disclaimer
    is compared case-insensitively (so "AFFILIATED" matches), but tokens such as
    "IDE" are checked case-sensitively so a rendered "Ide" is correctly rejected.
    """
    for ch in _ZERO_WIDTH:
        text = text.replace(ch, '')
    text = _WS_RE.sub(' ', text).strip()
    if not case_sensitive:
        text = text.casefold()
    return text


def check_required_string(ocr_text: str, required: str, case_sensitive: bool = False) -> bool:
    """True when `required` appears verbatim inside `ocr_text` after
    whitespace (and optional case) normalization."""
    haystack = normalize(ocr_text, case_sensitive)
    needle = normalize(required, case_sensitive)
    if not needle:
        return True
    return needle in haystack


# ---------------------------------------------------------------------------
# OCR backends
# ---------------------------------------------------------------------------

def _load_dotenv_token() -> None:
    """Best-effort: populate REPLICATE_API_TOKEN from the repo .env if it is not
    already in the environment. Never logs the value."""
    if os.environ.get('REPLICATE_API_TOKEN'):
        return
    env_path = ROOT / '.env'
    if not env_path.is_file():
        return
    try:
        for line in env_path.read_text(encoding='utf-8').splitlines():
            stripped = line.strip()
            if stripped.startswith('REPLICATE_API_TOKEN') and '=' in stripped:
                _, _, value = stripped.partition('=')
                value = value.strip().strip('"').strip("'")
                if value:
                    os.environ['REPLICATE_API_TOKEN'] = value
                break
    except OSError:
        pass


def ocr_tesseract(image_path: Path) -> Optional[str]:
    """Local OCR via pytesseract. Returns None if pytesseract/Pillow are missing
    or the tesseract binary is not installed."""
    try:
        import pytesseract  # type: ignore
        from PIL import Image
    except Exception:
        return None
    try:
        with Image.open(image_path) as img:
            return pytesseract.image_to_string(img)
    except Exception:
        # Most commonly: tesseract binary not on PATH (TesseractNotFoundError).
        return None


def _coerce_output(output: object) -> Optional[str]:
    if output is None:
        return None
    if isinstance(output, str):
        return output
    if isinstance(output, list):
        return '\n'.join(str(part) for part in output)
    if isinstance(output, dict):
        for key in ('text', 'output', 'result', 'transcription'):
            if key in output:
                return _coerce_output(output[key])
        return json.dumps(output)
    return str(output)


def _poll_replicate(payload: dict, token: str, deadline: float) -> Optional[dict]:
    status = payload.get('status')
    get_url = (payload.get('urls') or {}).get('get')
    while status in ('starting', 'processing') and get_url and time.monotonic() < deadline:
        time.sleep(2)
        req = urllib.request.Request(get_url, headers={'Authorization': f'Bearer {token}'})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
        except Exception:
            return None
        status = payload.get('status')
    return payload


def ocr_replicate(image_path: Path, model: str, timeout: int = 120) -> Optional[str]:
    """OCR via a Replicate model. Returns None when no token, no model, the model
    errors, or it 404s — all of which (correctly) mean OCR was NOT performed, so
    the caller fails closed rather than passing blind."""
    token = os.environ.get('REPLICATE_API_TOKEN')
    if not token or not model:
        return None
    try:
        raw = Path(image_path).read_bytes()
    except OSError:
        return None
    mime = mimetypes.guess_type(str(image_path))[0] or 'image/png'
    data_uri = f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')
    body = json.dumps({'input': {'image': data_uri}}).encode('utf-8')
    url = f'https://api.replicate.com/v1/models/{model}/predictions'
    req = urllib.request.Request(
        url, data=body, method='POST',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Prefer': 'wait',
        },
    )
    deadline = time.monotonic() + timeout
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except Exception:
        return None
    payload = _poll_replicate(payload, token, deadline)
    if not payload or payload.get('status') != 'succeeded':
        return None
    text = _coerce_output(payload.get('output'))
    return text or None


def make_default_ocr(replicate_model: str) -> OcrFn:
    """Build the production OCR function: try local tesseract, then Replicate."""
    _load_dotenv_token()

    def _run(image_path: Path) -> 'tuple[Optional[str], str]':
        if not Path(image_path).is_file():
            return None, 'file-missing'
        text = ocr_tesseract(image_path)
        if text is not None:
            return text, 'tesseract'
        text = ocr_replicate(image_path, replicate_model)
        if text is not None:
            return text, f'replicate:{replicate_model}'
        return None, 'unavailable'

    return _run


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate_asset(
    asset_id: str,
    image_path: str | Path,
    required_strings: list[dict],
    ocr_fn: OcrFn,
) -> dict:
    """Run the gate for one asset. Returns a RESULT dict. compliancePass defaults
    to False and only becomes True when OCR succeeded AND every required string
    was found."""
    result: dict = {
        'assetId': asset_id,
        'imagePath': str(image_path),
        'ocrBackend': None,
        'ocrText': None,
        'checks': [],
        'compliancePass': False,
        'requiresHumanReview': True,
        'notes': [],
    }

    text, backend = ocr_fn(Path(image_path))
    result['ocrBackend'] = backend

    if not text:
        if backend == 'file-missing':
            result['notes'].append(f'Image not found: {image_path}. Fail-closed: compliancePass=false.')
        else:
            result['notes'].append(
                'OCR unavailable (no local tesseract and no working Replicate OCR backend). '
                'Per fail-closed policy compliancePass=false and the asset is flagged for human '
                'review — we do NOT default to pass when the pixels could not be read.'
            )
        return result

    result['ocrText'] = text
    all_found = True
    for spec in required_strings:
        required = spec['text']
        case_sensitive = bool(spec.get('case_sensitive', False))
        found = check_required_string(text, required, case_sensitive)
        result['checks'].append({
            'required': required,
            'caseSensitive': case_sensitive,
            'found': found,
        })
        if not found:
            all_found = False

    result['compliancePass'] = all_found
    result['requiresHumanReview'] = not all_found
    if all_found:
        result['notes'].append(
            f'All {len(required_strings)} required string(s) verified character-for-character via {backend}.'
        )
    else:
        missing = [c['required'] for c in result['checks'] if not c['found']]
        result['notes'].append(
            f'FAILED: required string(s) missing or garbled in the rendered pixels: {missing!r}. '
            f'See ocrText (backend: {backend}) for the audited content.'
        )
    return result


# ---------------------------------------------------------------------------
# Manifest + CLI
# ---------------------------------------------------------------------------

def load_manifest(path: Path) -> dict:
    data = json.loads(path.read_text(encoding='utf-8'))
    return data.get('assets', {})


def _resolve_image(image: str) -> Path:
    p = Path(image)
    return p if p.is_absolute() else (ROOT / p)


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Fail-closed OCR gate asserting baked-in required strings in a rendered asset.',
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--asset', help='Asset id to verify (looked up in the manifest).')
    group.add_argument('--all', action='store_true', help='Verify every asset in the manifest.')
    group.add_argument('--image', help='Ad-hoc: path to a PNG to verify.')
    parser.add_argument('--require', action='append', default=[],
                        help='Ad-hoc required string (case-insensitive). Repeatable.')
    parser.add_argument('--require-exact', action='append', default=[],
                        help='Ad-hoc required string (case-sensitive, e.g. "IDE"). Repeatable.')
    parser.add_argument('--manifest', default=str(MANIFEST_PATH), help='Path to the compliance manifest.')
    parser.add_argument('--replicate-ocr-model', default=DEFAULT_REPLICATE_OCR_MODEL,
                        help='Replicate OCR model slug (owner/name) used when local tesseract is absent.')
    parser.add_argument('--json-out', help='Optional path to write the RESULT JSON (also written next to '
                                           'each image as <image>.compliance.json when verifying assets).')
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    ocr_fn = make_default_ocr(args.replicate_ocr_model)
    results: list[dict] = []

    if args.image:
        required = [{'text': s, 'case_sensitive': False} for s in args.require]
        required += [{'text': s, 'case_sensitive': True} for s in args.require_exact]
        if not required:
            print('error: --image requires at least one --require/--require-exact', file=sys.stderr)
            return 2
        results.append(evaluate_asset(Path(args.image).stem, _resolve_image(args.image), required, ocr_fn))
    else:
        manifest_path = Path(args.manifest)
        if not manifest_path.is_file():
            print(f'error: manifest not found: {manifest_path}', file=sys.stderr)
            return 2
        assets = load_manifest(manifest_path)
        targets = list(assets) if args.all else [args.asset]
        for asset_id in targets:
            entry = assets.get(asset_id)
            if entry is None:
                results.append({
                    'assetId': asset_id, 'imagePath': None, 'ocrBackend': None, 'ocrText': None,
                    'checks': [], 'compliancePass': False, 'requiresHumanReview': True,
                    'notes': [f'Asset id not found in manifest: {asset_id}'],
                })
                continue
            image_path = _resolve_image(entry['image'])
            res = evaluate_asset(asset_id, image_path, entry.get('requiredStrings', []), ocr_fn)
            results.append(res)
            # Write an audit sidecar next to the image (only when the image exists,
            # so a missing asset does not litter the media directory).
            if image_path.is_file():
                try:
                    sidecar = Path(str(image_path) + '.compliance.json')
                    sidecar.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding='utf-8')
                except OSError:
                    pass

    output = results[0] if len(results) == 1 else results
    print(json.dumps(output, indent=2, ensure_ascii=False))
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding='utf-8')

    return 0 if all(r['compliancePass'] for r in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
