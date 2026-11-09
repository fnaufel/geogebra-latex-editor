#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

if [[ $(git branch --show-current) != master ]]; then
  echo "Publish from master." >&2
  exit 1
fi
if [[ -n $(git status --porcelain) ]]; then
  echo "Commit source changes before publishing." >&2
  exit 1
fi

git fetch origin master
if [[ $(git rev-parse HEAD) != $(git rev-parse origin/master) ]]; then
  echo "Push master before publishing." >&2
  exit 1
fi

npm run build
if [[ ! -f dist/index.html ]]; then
  echo "The production build did not create dist/index.html." >&2
  exit 1
fi

publish_dir=$(mktemp -d "${TMPDIR:-/tmp}/geogebra-pages.XXXXXX")
cleanup() {
  git worktree remove --force "$publish_dir" >/dev/null 2>&1 || true
  rm -rf -- "$publish_dir"
}
trap cleanup EXIT

if git ls-remote --exit-code --heads origin gh-pages >/dev/null; then
  git fetch origin gh-pages
  git worktree add --detach "$publish_dir" origin/gh-pages
else
  git worktree add --detach "$publish_dir" HEAD
  git -C "$publish_dir" switch --orphan gh-pages
fi

find "$publish_dir" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf -- {} +
cp -R dist/. "$publish_dir/"
touch "$publish_dir/.nojekyll"
git -C "$publish_dir" add -A

if git -C "$publish_dir" diff --cached --quiet; then
  echo "Published files already match dist/."
  exit 0
fi

git -C "$publish_dir" commit -m "Publish local build from $(git rev-parse --short HEAD)"
git -C "$publish_dir" push origin HEAD:gh-pages
echo "Published local dist/ to gh-pages."
