#!/usr/bin/env bash
# push-ref.sh <dir> <paths> <ref> <message>
#
# Commits the files `<paths>` lists, one per line and relative to `<dir>`, as
# the whole tree of a commit with no parent, and force-pushes it to `<ref>` of
# this run's repository with `GITHUB_TOKEN`. A ref written this way is its
# latest and nothing else: what it replaced is the remote's to collect.
# raw.githubusercontent.com serves a file from it as from any ref.
#
# Prints the commit. Exits 1 when the files could not be committed and 2 when
# the push was refused, which a fork's read-only token does, so the step says
# why and the last ref stands.
set -uo pipefail

dir="$1" paths="$2" ref="$3" message="$4"

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
git init -q --bare "$repo/git" || exit 1
export GIT_DIR="$repo/git" GIT_WORK_TREE="$dir"
# Literal, because a store-encoded file name is not a pathspec.
git --literal-pathspecs add -f --pathspec-from-file="$paths" || exit 1
tree="$(git write-tree)" || exit 1
commit="$(git -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit-tree "$tree" -m "$message")" || exit 1

auth="$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"
echo "::add-mask::$auth" >&2
git -c http.extraheader="AUTHORIZATION: basic $auth" \
  push -q --force "$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git" "$commit:$ref" >&2 || exit 2

echo "$commit"
