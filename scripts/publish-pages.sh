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

remote_master=$(git ls-remote origin refs/heads/master | cut -f1)
if [[ $(git rev-parse HEAD) != "$remote_master" ]]; then
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
  rm -rf -- "$publish_dir"
}
trap cleanup EXIT

remote_url=$(git remote get-url origin)
if git ls-remote --exit-code --heads origin gh-pages >/dev/null; then
  git clone --quiet --single-branch --branch gh-pages "$remote_url" "$publish_dir"
else
  git clone --quiet --single-branch --branch master "$remote_url" "$publish_dir"
  git -C "$publish_dir" switch --orphan gh-pages
fi

git -C "$publish_dir" config user.name "$(git config user.name)"
git -C "$publish_dir" config user.email "$(git config user.email)"
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
