#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

target=""
case "$(uname -s)" in Darwin) target=mac ;; MINGW*|MSYS*|CYGWIN*) target=win ;; *) target=all ;; esac
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) target="${2:?Missing target}"; shift 2 ;;
    -h|--help) echo 'Usage: scripts/release-preflight.sh [--target mac|win|all]'; exit 0 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done
case "$target" in mac|macos) target=mac ;; win|windows) target=win ;; all) ;; *) echo "Invalid target: $target"; exit 1 ;; esac

expected_node="$(tr -d '[:space:]' < .nvmrc)"
actual_node="$(node -p 'process.versions.node')"
[[ "$actual_node" == "$expected_node" ]] || { echo "Use Node $expected_node from .nvmrc (found $actual_node)"; exit 1; }
[[ -s LICENSE && -s THIRD_PARTY_NOTICES.md ]] || { echo 'Release license and third-party notices are required'; exit 1; }
if [[ -n "${GITHUB_REF_NAME:-}" ]]; then
  tag_version="${GITHUB_REF_NAME#v}"
  package_version="$(node -p "require('./apps/desktop/package.json').version")"
  [[ "$tag_version" == "$package_version" ]] || { echo "Tag version $tag_version does not match desktop package $package_version"; exit 1; }
fi
require_secret() { [[ -n "${!1:-}" ]] || { echo "Missing release credential: $1"; exit 1; }; }
if [[ "$target" == mac || "$target" == all ]]; then
  for name in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID CSC_LINK CSC_KEY_PASSWORD; do require_secret "$name"; done
  if [[ "$(uname -s)" == Darwin ]]; then command -v xcrun >/dev/null; command -v codesign >/dev/null; fi
fi
if [[ "$target" == win || "$target" == all ]]; then
  for name in WIN_CSC_LINK WIN_CSC_KEY_PASSWORD; do require_secret "$name"; done
fi
echo "Release prerequisites ready for $target. Installers still require verification before publication."
