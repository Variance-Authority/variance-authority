#!/usr/bin/env bash
# The head merged with the commit the mainline's record was made at, as
# `action.yml` says. Reads COMMIT, HEAD_COMMIT, ON_CONFLICT and, when set,
# EXPECT, the merge another job of the run made; writes `merged` and `checkout`
# to GITHUB_OUTPUT.
set -euo pipefail

if [ -z "$COMMIT" ]; then
  echo "merged=false" >> "$GITHUB_OUTPUT"
  exit 0
fi
checked=$(git rev-parse HEAD)
later=$(git show -s --format=%ct "$COMMIT" "$HEAD_COMMIT" | sort -n | tail -n 1)
git checkout --quiet --detach "$COMMIT"
# Every field of the commit from here, none from the machine: an identity in
# the environment wins over one in the config.
name=variance-authority
email=variance-authority@users.noreply.github.com
if GIT_AUTHOR_NAME=$name GIT_AUTHOR_EMAIL=$email GIT_COMMITTER_NAME=$name GIT_COMMITTER_EMAIL=$email \
  GIT_AUTHOR_DATE="$later +0000" GIT_COMMITTER_DATE="$later +0000" \
  git merge --quiet --no-ff --no-edit -m "Merge $HEAD_COMMIT with the record's commit $COMMIT" "$HEAD_COMMIT"; then
  merged=$(git rev-parse HEAD)
  if [ -n "${EXPECT:-}" ] && [ "$merged" != "$EXPECT" ]; then
    echo "::error::The merge of $HEAD_COMMIT with ${COMMIT:0:12} is $merged here, and $EXPECT in the job that decided it: the two checkouts differ."
    exit 1
  fi
  echo "The checkout is $HEAD_COMMIT merged with $COMMIT, the commit the mainline's record was made at: $merged."
  echo "merged=true" >> "$GITHUB_OUTPUT"
  echo "checkout=$merged" >> "$GITHUB_OUTPUT"
  exit 0
fi
# A conflict leaves unmerged paths; any other stop (a hook, an object the
# partial clone could not fetch) is not an answer about the head.
conflicted=$(git ls-files --unmerged)
git merge --abort 2>/dev/null || git reset --quiet --hard
git checkout --quiet --detach "$checked"
if [ -z "$conflicted" ]; then
  echo "::error::Merging $HEAD_COMMIT with ${COMMIT:0:12} stopped without a conflict; git's message is above."
  exit 1
fi
if [ "$ON_CONFLICT" = fail ]; then
  echo "::error::The head conflicts with ${COMMIT:0:12}, which the base job merged it with."
  exit 1
fi
echo "::notice::The head conflicts with ${COMMIT:0:12}, the commit the mainline's record was made at, so it stays merged with the base tip, and the selection measures what the base gained since from the record too."
echo "merged=false" >> "$GITHUB_OUTPUT"
