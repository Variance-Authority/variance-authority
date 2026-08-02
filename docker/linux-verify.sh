#!/usr/bin/env bash
#
# Run the suite and both corpus measurements on Linux, and keep the output.
#
# Results are written next to the macOS numbers rather than replacing them.
# Spec 0007 exists because a second platform can *refute* claims the first one
# could only fail to contradict, and a run that overwrites the baseline it was
# meant to be compared against has destroyed its own evidence.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/docker/results"
IMAGE="variance-authority-linux-verify"

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

echo
echo "results in ${OUT}"
echo "compare against the macOS numbers recorded in docs/context/checkpoint.md;"
echo "a semantic verdict that differs across platforms refutes ADR-0010 and is"
echo "the finding, not a failure to be retried away."
