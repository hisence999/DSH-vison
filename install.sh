#!/usr/bin/env bash
# DSH Vision one-line installer (Linux / macOS)
# Usage (one line):
#   curl -fsSL https://raw.githubusercontent.com/hisence999/DSH-vison/main/install.sh | bash
set -euo pipefail

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
DEST="$DSH_HOME_DIR/.agent-presets/dsh-vision"
mkdir -p "$DEST"

BASE="https://raw.githubusercontent.com/hisence999/DSH-vison/main/preset"

echo "Installing DSH Vision to: $DEST"
for f in agent.cordis.yml preset.yml plugin.mjs; do
  curl -fsSL "$BASE/$f" -o "$DEST/$f"
  echo "  OK  $f"
done

echo ""
echo "Done! Start a new session and pick the \"DSH Vision\" preset."
echo "The vision model is auto-detected; edit plugin.mjs to pin one."
