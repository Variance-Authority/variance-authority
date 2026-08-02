# Linux verification (spec 0007).
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
FROM mcr.microsoft.com/playwright:v1.49.0-noble

WORKDIR /work

# Dependencies first, so a source edit does not re-resolve the workspace.
COPY package.json yarn.lock .yarnrc.yml* ./
COPY packages ./packages
COPY examples ./examples
COPY tsconfig.base.json tsconfig.json vitest.config.ts ./

RUN corepack enable && yarn install --immutable || yarn install

CMD ["bash", "-lc", "yarn build && yarn test"]
