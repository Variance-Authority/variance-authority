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
for run in 1 2 3; do
  echo "--- linux run ${run}"
  docker run --rm --ipc=host "${IMAGE}" \
    bash -lc 'yarn build && yarn test 2>&1' | tee "${OUT}/linux-run-${run}.log"
done

# What ran, checked rather than assumed.
#
# The image copied four directories and none of the cases or tools until
# 2026-08-03, so it would have printed a green Linux suite that had never
# executed this repository's own rules. Nothing said so, because a suite that
# does not collect a file reports one fewer file and no reader counts. These are
# the two families whose absence is invisible in a summary, named individually so
# the message says which one went missing.
missing=()
for family in 'tools/documentation.test.ts' 'tools/boundaries.test.ts' 'cases/' 'examples/kitchen-sink'; do
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

echo
echo "results in ${OUT}"
echo "compare against the macOS numbers recorded in docs/context/checkpoint.md;"
echo "a semantic verdict that differs across platforms refutes ADR-0010 and is"
echo "the finding, not a failure to be retried away."
