#!/usr/bin/env bash
#
# Run the suite and both corpus measurements on Linux, and keep the output.
#
# Results are written next to the macOS numbers rather than replacing them.
# This exists because a second platform can *refute* claims the first one could
# only fail to contradict, and a run that overwrites the baseline it was meant to
# be compared against has destroyed its own evidence.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/docker/results"
IMAGE="variance-authority-linux-verify"

# The build context, before the daemon — a wrong input is a fact about this
# checkout and stays wrong however the machine is configured.
#
# A git *worktree* keeps `.git` as a file pointing at the main checkout, and a
# `COPY .` carries that file into an image where the path it names does not
# exist. `git ls-files` then fails, and the two suites that enumerate with it —
# the boundary rules and the documentation rules — do not run. The image would
# still build, still go green, and still be missing this repository's own gate,
# which is the shape of failure this whole spec exists to catch. So it is
# refused rather than discovered.
if [ ! -d "${ROOT}/.git" ]; then
  echo "${ROOT}/.git is not a directory, so this is a worktree or a submodule." >&2
  echo "Build from a clone: git ls-files cannot answer inside the image, and the" >&2
  echo "tools suites would be silently absent from the run." >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "docker daemon is not running; start it and retry" >&2
  exit 2
fi

mkdir -p "${OUT}"

docker build -f "${ROOT}/docker/linux-verify.Dockerfile" -t "${IMAGE}" "${ROOT}"

# Three runs, not one. A single run cannot distinguish a platform difference
# from a loaded machine, and the cost ratios this is re-measuring are exactly
# the numbers a noisy container would misreport.
#
# `yarn check` and not only `yarn test`, because the two collect disjoint sets.
# The repository's own rules are `tools/**/*.check.ts` and run from
# `vitest.checks.config.ts`; `yarn test` does not see one of them. Running the
# suite alone would have carried this image past the guard below while the
# boundary and documentation rules had never executed on Linux at all — which is
# the same hollow pass that guard was written to refuse.
#
# FIXME: this still runs neither corpus measurement the header above promises:
# examples/kitchen-sink/scripts/bench.mjs and cases/incumbent-case/scripts/incumbent.mjs.
# Run both, or stop promising them at the top of this file.
for run in 1 2 3; do
  echo "--- linux run ${run}"
  docker run --rm --ipc=host "${IMAGE}" \
    bash -lc 'echo "arch: $(uname -m)"; yarn build && yarn check && yarn test 2>&1' \
    | tee "${OUT}/linux-run-${run}.log"
done

# Which machine actually ran, recorded rather than assumed.
#
# On an Apple Silicon host a linux/amd64 image runs under emulation. The semantic
# verdicts survive that — nothing machine-bound reaches the box tree, which is
# the claim being tested — but **the cost ratios do not**, and re-measuring
# 7.5ms/205ms under Rosetta would produce numbers that describe an emulator and
# read as a platform. Stated here so a reader of `${OUT}` knows which half of the
# log to believe.
guest="$(grep -m1 '^arch: ' "${OUT}/linux-run-1.log" | cut -d' ' -f2 || true)"
host="$(uname -m)"
case "${host}:${guest}" in
  arm64:aarch64 | x86_64:x86_64) echo "arch: ${guest}, native" ;;
  *)
    echo >&2
    echo "the container reports ${guest} on a ${host} host, so this ran emulated." >&2
    echo "Semantic verdicts still stand; every timing in ${OUT} describes the" >&2
    echo "emulator and must not be recorded as a Linux measurement." >&2
    ;;
esac

# What ran, checked rather than assumed.
#
# The image copied four directories and none of the cases or tools until
# 2026-08-03, so it would have printed a green Linux suite that had never
# executed this repository's own rules. Nothing said so, because a suite that
# does not collect a file reports one fewer file and no reader counts. These are
# the families whose absence is invisible in a summary, named individually so the
# message says which one went missing.
#
# The documentation rules are six files rather than one, so that family is named
# by the prefix they share: `tools/docs-` matches whichever of
# `tools/docs-claims.check.ts` and its siblings the run collected, and a rename
# within the family does not quietly empty this list.
missing=()
for family in 'tools/docs-' 'tools/boundaries.check.ts' 'cases/' 'examples/kitchen-sink'; do
  grep -q -- "${family}" "${OUT}/linux-run-1.log" || missing+=("${family}")
done

if [ ${#missing[@]} -gt 0 ]; then
  echo >&2
  echo "the run did not include: ${missing[*]}" >&2
  echo "That is a partial suite reported as a whole one — the failure this" >&2
  echo "harness exists to catch, arriving in the harness. Check the build" >&2
  echo "context and .dockerignore before reading any number in ${OUT}." >&2
  exit 1
fi

# **A named file is not a file that ran**, and the check above cannot tell them
# apart: a skipped suite prints its own name too.
#
# That gap is not hypothetical, it is the most likely way this image fails. Every
# browser suite is gated on whether Playwright's resolved executable is present,
# and the image tag decides which browser build sits in `/ms-playwright` while
# the lockfile decides which one Playwright goes looking for. Pinned apart — as
# they were until 2026-08-03, `v1.49.0` against a resolved 1.62.1 — all ten gated
# files skip, the summary is green, and this harness reports that portability
# holds without having executed one cross-platform measurement.
#
# So: on Linux, with the right image, nothing may skip.
# `tools/boundaries.check.ts` keeps the two pins from drifting again.
if grep -qE '[0-9]+ skipped' "${OUT}/linux-run-1.log"; then
  echo >&2
  echo "suites skipped inside the container:" >&2
  grep -E '^\s*↓|skipped\.' "${OUT}/linux-run-1.log" >&2 || true
  echo >&2
  echo "A skipped browser suite is the hollow pass this harness exists to refuse:" >&2
  echo "the log is green and no cross-platform measurement was taken. Check that" >&2
  echo "the image tag matches the playwright the lockfile resolves." >&2
  exit 1
fi

echo
echo "results in ${OUT}"
echo "compare against the macOS numbers recorded in docs/context/checkpoint.md;"
echo "a semantic verdict that differs across platforms refutes ADR-0010 and is"
echo "the finding, not a failure to be retried away."
