#!/usr/bin/env bash
# DSH-vison: patch the dsh-host-apiproxy settings exposure allowlist so the
# "dsh-image-vision" settings namespace is served to the web settings page.
# Idempotent — safe to run repeatedly.
#
# Usage:  bash patch-apiproxy.sh
set -euo pipefail

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"

candidates=(
  "$DSH_HOME_DIR/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
  "$DSH_HOME_DIR/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
)
if command -v npm >/dev/null 2>&1; then
  npm_root="$(npm root -g 2>/dev/null || true)"
  if [ -n "$npm_root" ]; then
    candidates+=("$npm_root/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js")
    candidates+=("$npm_root/@deepseek-ai/dsh-host-apiproxy/lib/index.js")
  fi
fi

file=""
for c in "${candidates[@]}"; do
  if [ -f "$c" ]; then
    file="$(readlink -f "$c" 2>/dev/null || echo "$c")"
    break
  fi
done
if [ -z "$file" ]; then
  echo "dsh-host-apiproxy/lib/index.js not found; cannot patch." >&2
  exit 1
fi

if grep -q '"dsh-image-vision"' "$file"; then
  echo "already patched: $file"
  exit 0
fi
if ! grep -q '"web-search-deepseek"' "$file"; then
  echo "allowlist anchor not found; unsupported DSH version?" >&2
  exit 1
fi

awk '
  /"web-search-deepseek"/ && !done {
    print "\t\"" $0 "\","
    print "\t// dsh-image-vision: settings section for the DSH-vison plugin (added by DSH-vison installer)"
    print "\t\"dsh-image-vision\""
    done = 1
    next
  }
  { print }
' "$file" > "$file.tmp" && mv "$file.tmp" "$file"

echo "patched: $file"
echo "Restart DSH, then open Settings → 图片理解 (Image Vision)."
