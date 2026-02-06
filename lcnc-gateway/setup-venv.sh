#!/usr/bin/env bash
set -euo pipefail

# Run from anywhere; resolve relative to THIS file
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VENV_DIR="$ROOT_DIR/.venv"
REQ_FILE="$ROOT_DIR/requirements.txt"

echo "==> gateway dir: $ROOT_DIR"
echo "==> venv:        $VENV_DIR"
echo "==> requirements:$REQ_FILE"

if [[ ! -f "$REQ_FILE" ]]; then
  echo "ERROR: requirements.txt not found at: $REQ_FILE"
  exit 1
fi

echo "==> Removing existing venv (if any)..."
rm -rf "$VENV_DIR"

echo "==> Creating venv with system-site-packages (needed for linuxcnc)..."
python3 -m venv "$VENV_DIR" --system-site-packages

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

echo "==> Upgrading pip..."
python3 -m pip install -U pip

echo "==> Installing requirements..."
python3 -m pip install -r "$REQ_FILE"

echo "==> Verifying imports..."
python3 -c "import linuxcnc, fastapi, uvicorn; print('OK: linuxcnc + fastapi + uvicorn')"

echo "Done."
