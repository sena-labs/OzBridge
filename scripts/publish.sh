#!/usr/bin/env bash
# Manual publish script for macOS/Linux
# Usage:
#   export VSCE_PAT="<azure-devops-pat>"
#   export OVSX_TOKEN="<open-vsx-token>"
#   ./scripts/publish.sh [--dry-run] [--skip-tests]
#
# See docs/PUBLISHING.md for the full publisher setup procedure.

set -euo pipefail

DRY_RUN=0
SKIP_TESTS=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --skip-tests) SKIP_TESTS=1; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [[ $DRY_RUN -eq 0 && -z "${VSCE_PAT:-}" ]]; then
    echo "ERROR: VSCE_PAT is not set. Run: export VSCE_PAT='<token>'"
    exit 1
fi

if [[ $DRY_RUN -eq 0 && -z "${OVSX_TOKEN:-}" ]]; then
    echo "WARNING: OVSX_TOKEN is not set. Skipping Open VSX publish."
fi

VERSION=$(node -p "require('./package.json').version")
NAME=$(node -p "require('./package.json').name")
PUBLISHER=$(node -p "require('./package.json').publisher")
VSIX_OUTPUT="${NAME}-${VERSION}.vsix"

echo ""
echo "== Publishing ${NAME}@${VERSION} =="

echo ""
echo "[1/5] Installing dependencies..."
npm ci

echo ""
echo "[2/5] Type-checking..."
npm run compile

if [[ $SKIP_TESTS -eq 0 ]]; then
    echo ""
    echo "[3/5] Running tests..."
    npm test
else
    echo ""
    echo "[3/5] Tests skipped (--skip-tests)"
fi

echo ""
echo "[4/5] Packaging VSIX..."
npm run build
npx @vscode/vsce package --no-dependencies -o "$VSIX_OUTPUT"

ls -lh "$VSIX_OUTPUT"

if [[ $DRY_RUN -eq 1 ]]; then
    echo ""
    echo "[5/5] Dry-run: skipping publish steps."
    echo "VSIX available at: $VSIX_OUTPUT"
    exit 0
fi

echo ""
echo "[5/5] Publishing..."

echo ""
echo ">>> VS Code Marketplace"
npx @vscode/vsce publish --packagePath "$VSIX_OUTPUT" -p "$VSCE_PAT"

if [[ -n "${OVSX_TOKEN:-}" ]]; then
    echo ""
    echo ">>> Open VSX"
    npx ovsx publish "$VSIX_OUTPUT" -p "$OVSX_TOKEN"
fi

echo ""
echo "=== Published successfully ==="
echo "VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=${PUBLISHER}.${NAME}"
echo "Open VSX:            https://open-vsx.org/extension/${PUBLISHER}/${NAME}"
