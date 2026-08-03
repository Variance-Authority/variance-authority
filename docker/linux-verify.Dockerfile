# Linux verification.
#
# Every measurement in this repository was taken on one Mac with one Chromium.
# Several decisions rest on numbers that have therefore only ever been observed
# on a single machine, and one claim — that the semantic representation is
# portable because machine-bound inputs cannot reach the box tree (ADR-0010) —
# is a statement about *two* machines that has never been tested with two.
#
# This image exists to disprove it if it is wrong. A confirmation is worth
# little; a divergence in semantic verdicts across platforms would refute
# ADR-0010 and invalidate the tiering it justifies, which is the most valuable
# thing this file could produce.
#
# The base image ships Chromium and the font stack Playwright expects, which
# matters for a second reason: a Linux container ships metric-compatible
# substitutes precisely so that layout does not move, and the font probe reads
# those as missing. The false-alarm rate that produces is measured here rather
# than assumed.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /work

# The whole tree, and the reason is that "the full suite" means the full suite.
#
# This copied `packages`, `examples` and four config files until 2026-08-03, and
# would not have run the thing it was built for. `cases/*` is a declared
# workspace, so `yarn install --immutable` fails outright without it; `tools/**`
# is in the vitest include, so the boundary and documentation rules — this
# repository's own gate — would simply not have been among the tests; and
# `docs/` holds most of what the documentation rules resolve against. A run of
# that image would have reported a green Linux suite that had never executed
# `cases/`, `tools/`, or a single markdown check.
#
# `.git` is included deliberately. Both `tools` suites enumerate what to check
# with `git ls-files`, which is the right question — tracked files, not whatever
# is lying in the directory — and it needs a repository to answer it.
# `.dockerignore` is what keeps this from also carrying a macOS `node_modules`
# into the machine this image exists to be different from.
COPY . .

# `--immutable`, with no fallback. The previous `|| yarn install` re-resolved the
# workspace whenever the immutable install failed, which meant a broken build
# context produced an image with a *different dependency set* rather than an
# error — and then compared its results to the macOS numbers as if the only
# difference were the platform. A resolution difference reported as a platform
# difference is the one wrong answer this spec can produce.
RUN corepack enable && yarn install --immutable

CMD ["bash", "-lc", "yarn build && yarn test"]
