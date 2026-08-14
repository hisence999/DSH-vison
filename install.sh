#!/usr/bin/env bash
# DSH Vision one-line installer (Linux / macOS)
# Usage (one line):
#   curl -fsSL https://raw.githubusercontent.com/hisence999/DSH-vison/main/install.sh | bash
#
# Installs:
#   1) apiproxy allowlist patch (required for the settings page)
#   2) the plugin into $DSH_HOME/profiles/node_modules/dsh-image-vision
#   3) the image-vision row into every profiles/<name>/cordis.patch.yml
# Restart DSH after installing.
set -euo pipefail

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
BASE="https://raw.githubusercontent.com/hisence999/DSH-vison/main"

# ---------- 1) apiproxy allowlist patch (idempotent) ----------
find_apiproxy_file() {
  local candidates=(
    "$DSH_HOME_DIR/profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
    "$DSH_HOME_DIR/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js"
  )
  if command -v npm >/dev/null 2>&1; then
    local npm_root
    npm_root="$(npm root -g 2>/dev/null || true)"
    if [ -n "$npm_root" ]; then
      candidates+=("$npm_root/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js")
      candidates+=("$npm_root/@deepseek-ai/dsh-host-apiproxy/lib/index.js")
    fi
  fi
  local c
  for c in "${candidates[@]}"; do
    if [ -f "$c" ]; then
      # resolve symlinks/junctions
      readlink -f "$c" 2>/dev/null || echo "$c"
      return 0
    fi
  done
  return 1
}

patch_apiproxy() {
  local file
  if ! file="$(find_apiproxy_file)"; then
    echo "  !! dsh-host-apiproxy/lib/index.js not found; skipping allowlist patch (settings page will not work)"
    return
  fi
  if grep -q '"dsh-image-vision"' "$file"; then
    echo "  OK  apiproxy already patched: $file"
    return
  fi
  if ! grep -q '"web-search-deepseek"' "$file"; then
    echo "  !! allowlist anchor not found; skipping apiproxy patch (unsupported DSH version?)"
    return
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
  echo "  OK  apiproxy allowlist patched: $file"
}

echo "== 1/3 apiproxy settings allowlist patch =="
patch_apiproxy

# ---------- 2) global plugin ----------
PKG_DIR="$DSH_HOME_DIR/profiles/node_modules/dsh-image-vision"
mkdir -p "$PKG_DIR"
echo ""
echo "== 2/3 installing plugin to $PKG_DIR =="
for f in index.js client.js package.json; do
  curl -fsSL "$BASE/$f" -o "$PKG_DIR/$f"
  echo "  OK  $f"
done

# ---------- 3) profile patch row ----------
echo ""
echo "== 3/3 writing profile patch (image-vision row) =="
PATCH_ROW='
# dsh-image-vision: give text-only models image understanding (auto-describes images).
- insert:
    - id: image-vision
      name: dsh-image-vision
      config:
        enabled: true
        patchAdmission: true
'
PATCHED=0
if [ -d "$DSH_HOME_DIR/profiles" ]; then
  while IFS= read -r -d '' patch_file; do
    if grep -qE '^[[:space:]]*- id: image-vision[[:space:]]*$' "$patch_file"; then
      echo "  OK  already present: $patch_file"
    else
      printf '\n%s\n' "$PATCH_ROW" >> "$patch_file"
      echo "  OK  written: $patch_file"
    fi
    PATCHED=1
  done < <(find "$DSH_HOME_DIR/profiles" -name 'cordis.patch.yml' -type f -print0)
fi
if [ "$PATCHED" -eq 0 ]; then
  echo "  !! no profiles/*/cordis.patch.yml found; add the image-vision row manually"
fi

echo ""
echo "Done! Restart DSH, then open Settings → 图片理解 (Image Vision) to view/save configuration."
