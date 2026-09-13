#!/usr/bin/env bash
# Validate one architecture-specific Tauri .app and the DMG that contains it.
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <arm64|x86_64> <app-path> <dmg-path>" >&2
  exit 2
fi

expected_arch=$1
app_path=$2
dmg_path=$3
case "$expected_arch" in
  arm64|x86_64) ;;
  *) echo "unsupported architecture: $expected_arch" >&2; exit 2 ;;
esac

plist="$app_path/Contents/Info.plist"
[[ -d "$app_path" && -f "$plist" ]] || { echo "missing app or Info.plist: $app_path" >&2; exit 1; }
[[ -f "$dmg_path" ]] || { echo "missing DMG: $dmg_path" >&2; exit 1; }

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$2"
}

validate_app() {
  local candidate=$1
  local candidate_plist="$candidate/Contents/Info.plist"
  [[ -d "$candidate" && -f "$candidate_plist" ]] || return 1

  test "$(plist_value CFBundleIdentifier "$candidate_plist")" = "com.feoh.linkdqueue.desktop"
  test "$(plist_value LSMinimumSystemVersion "$candidate_plist")" = "12.0"
  local executable
  executable="$(plist_value CFBundleExecutable "$candidate_plist")"
  [[ -f "$candidate/Contents/MacOS/$executable" ]] || return 1

  local architectures
  architectures="$(lipo -archs "$candidate/Contents/MacOS/$executable")"
  test "$architectures" = "$expected_arch"
  lipo -verify_arch "$expected_arch" "$candidate/Contents/MacOS/$executable"
  echo "app=$candidate"
  echo "identifier=$(plist_value CFBundleIdentifier "$candidate_plist")"
  echo "minimum-system=$(plist_value LSMinimumSystemVersion "$candidate_plist")"
  echo "executable=$candidate/Contents/MacOS/$executable"
  echo "architectures=$architectures"
}

validate_app "$app_path"

mount_point="$(mktemp -d)"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_point" -quiet || true
  fi
  rmdir "$mount_point" 2>/dev/null || true
}
trap cleanup EXIT

hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_point" >/dev/null
mounted=true
dmg_app="$(find "$mount_point" -type d -name '*.app' -print -quit)"
[[ -n "$dmg_app" ]] || { echo "DMG does not contain an app" >&2; exit 1; }
validate_app "$dmg_app"
echo "dmg=$dmg_path"
