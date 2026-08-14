#!/usr/bin/env bash
# DSH Vision uninstaller (Linux / macOS)
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/hisence999/DSH-vison/main/uninstall.sh | bash
#
# Removes:
#   1) $DSH_HOME/profiles/node_modules/dsh-image-vision/ (the plugin package)
#   2) the image-vision insert row from every profiles/<name>/cordis.patch.yml
#   3) the apiproxy allowlist patch (removes dsh-image-vision)
#   4) settings.yaml config is kept by default (restored on reinstall);
#      pass --purge-config to remove it too
# Restart DSH afterwards.
set -euo pipefail

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PURGE=0
if [ "${1:-}" = "--purge-config" ]; then PURGE=1; fi

# ---------- 1) remove the plugin package ----------
PKG_DIR="$DSH_HOME_DIR/profiles/node_modules/dsh-image-vision"
if [ -d "$PKG_DIR" ]; then
  rm -rf "$PKG_DIR"
  echo "  OK  removed plugin package: $PKG_DIR"
else
  echo "  --  plugin package not present, skipping"
fi

# ---------- 2) revert the apiproxy allowlist ----------
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
      readlink -f "$c" 2>/dev/null || echo "$c"
      return 0
    fi
  done
  return 1
}

if file="$(find_apiproxy_file)" && grep -q '"dsh-image-vision"' "$file"; then
  if command -v perl >/dev/null 2>&1; then
    perl -0pi -e 's/"web-search-deepseek",\s*\/\/[^\r\n]*dsh-image-vision[^\r\n]*\r?\n[ \t]*"dsh-image-vision"/"web-search-deepseek"/g' "$file"
    echo "  OK  reverted apiproxy allowlist: $file"
  else
    echo "  !!  perl not found; revert $file manually (remove the dsh-image-vision lines)"
  fi
else
  echo "  --  apiproxy not patched or not found, skipping"
fi

# ---------- 3) remove the profile patch row ----------
PATCHED=0
if [ -d "$DSH_HOME_DIR/profiles" ]; then
  while IFS= read -r -d '' patch_file; do
    if grep -q 'image-vision' "$patch_file"; then
      if command -v perl >/dev/null 2>&1; then
        perl -0pi -e 's/^[ \t]*# dsh-image-vision: give text-only models image understanding[^\r\n]*\r?\n[ \t]*- insert:\r?\n[ \t]*- id: image-vision\r?\n[ \t]*name: dsh-image-vision\r?\n[ \t]*config:\r?\n[ \t]*enabled: true\r?\n[ \t]*patchAdmission: true\r?\n//mg' "$patch_file"
        echo "  OK  removed image-vision row: $patch_file"
      else
        echo "  !!  perl not found; remove the image-vision block from $patch_file manually"
      fi
      PATCHED=1
    else
      echo "  --  no image-vision row in $patch_file, skipping"
    fi
  done < <(find "$DSH_HOME_DIR/profiles" -name 'cordis.patch.yml' -type f -print0)
fi
if [ "$PATCHED" -eq 0 ]; then
  echo "  --  no cordis.patch.yml with an image-vision row found"
fi

# ---------- 4) optional: purge settings.yaml config ----------
if [ "$PURGE" -eq 1 ]; then
  SETTINGS_FILE="$DSH_HOME_DIR/settings.yaml"
  if [ -f "$SETTINGS_FILE" ] && grep -qE '^dsh-image-vision:' "$SETTINGS_FILE"; then
    perl -0pi -e 's/^dsh-image-vision:[^\r\n]*\r?\n(?:[ \t]+[^\r\n]*\r?\n)*//mg' "$SETTINGS_FILE"
    echo "  OK  purged dsh-image-vision config from settings.yaml"
  else
    echo "  --  no dsh-image-vision config in settings.yaml, skipping"
  fi
fi

echo ""
echo "Uninstall done! Restart DSH for the changes to take effect."
