# Reviewing `@variance-authority/png`

Decodes two PNGs and compares them into a `ChangeMask` and a count per
policy, aligning rows when the heights differ; draws the diff and the
before-beside-after change image; wraps a foreign PNG as a `Raster`; and
measures a difference field under `/difference`. `observe` and `cli` call it;
it implements the `raster` contracts with `pngjs` and `pixelmatch`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/png/`.

## Contracts

- **One comparison, however the bytes arrive.** `comparePngs`,
  `compareRasters` and `png/mask` end in `comparePixels`; a mask built from
  RGBA and one built from PNG bytes are the same mask. Written in the
  [README](README.md#the-rest-of-the-api).
- **The mask and the counts describe one comparison.** Isolating on a policy
  not counted throws. Written in the [README](README.md#the-two-policies) and
  pinned by [`src/compare.test.ts`](src/compare.test.ts) › "refuses to return
  a mask from a policy it was not asked to count".
- **No pairing makes a page read as unchanged.** A row that moved, came or
  went is a change; a row pairing is kept only when it leaves fewer pixels
  differing than position, every unpaired row charged in full, and a tie moves
  nothing. Written in the
  [README](README.md#content-that-moved-is-aligned) and pinned by
  [`src/align.test.ts`](src/align.test.ts) › "still finds a pixel that changed
  in the content that moved" and "compares position by position rather than
  remove a row to save a pixel".
- **Past one search the rows still pair.** Pinned by
  [`src/align.test.ts`](src/align.test.ts) › "pairs the rows under an edit
  longer than one search allows" and "compares a page whose stretches nest as
  deep as it is long".
- **Widths that differ are padded white, top-left, with no `alignment`.**
  Written in the [README](README.md#content-that-moved-is-aligned) and pinned
  by [`src/align.test.ts`](src/align.test.ts) › "compares position by position
  when the widths differ".
- **`/difference` refuses what comparison pads.** Different sizes throw
  `DifferenceFieldError`; source hashes are over the encoded bytes; alpha is
  `opaque` only when every pixel is. Pinned by
  [`src/difference.test.ts`](src/difference.test.ts) › "refuses two PNGs of
  different sizes" and "hashes the encoded bytes, not the decoded pixels".
- **A foreign raster claims nothing it did not see.** No components, no
  fonts, the image as its own digest, `painter` and scale partition the store.
  Written in the [README](README.md#png-bytes-this-project-did-not-paint) and
  pinned by [`src/foreign.test.ts`](src/foreign.test.ts) › "carries no
  components, because absent means unknown".
- **`pngSize` says nothing about bytes that are not a PNG.** Pinned by
  [`src/size.test.ts`](src/size.test.ts).

## Where to look for a counterexample

- `align.ts` and `edit-script.ts`: a grown blank run, a band rewritten
  between two kept runs, a one-pixel rule starting a row earlier, a page past
  the 2,000-run search.
- `change.ts` and `change-draw.ts`: the change image is read by a person; a
  region it marks that the mask does not hold is a false positive.
