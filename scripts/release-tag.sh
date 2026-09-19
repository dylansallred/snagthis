#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-}"
tag="v${version#v}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Usage: scripts/release-tag.sh X.Y.Z'; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Commit the intended release changes before tagging'; exit 1; }
[[ "$(git branch --show-current)" == main ]] || { echo 'Release tags must point to main'; exit 1; }
[[ "${tag#v}" == "$(node -p "require('./apps/desktop/package.json').version")" ]] || { echo 'Tag and desktop package versions must match'; exit 1; }
if git show-ref --verify --quiet "refs/tags/$tag"; then echo "Tag already exists: $tag"; exit 1; fi
if [[ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]]; then echo "Remote tag already exists: $tag"; exit 1; fi
npm run verify
git tag -a "$tag" -m "Release $tag"
git push origin "refs/tags/$tag"
echo "Pushed $tag. CI will build and validate every installer before the publish job can run."
