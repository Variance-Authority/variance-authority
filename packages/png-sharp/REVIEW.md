# Reviewing `@variance-authority/png-sharp`

## Contracts

- **The decoder changes what a run costs, never what it decides.** Written in
  [README](README.md#the-two-decoders-produce-the-same-pixels); pinned by
  [`src/decoder.test.ts`](src/decoder.test.ts).
- **Four channels, always.** Written in
  [README](README.md#the-two-decoders-produce-the-same-pixels) and
  [`sharpDecoder`](src/index.ts).
- **A native addon stays out of `png`.** Written in [ADR-0013][adr-0013].

## Not this package's

- Falling back to `pngjs` when the addon will not load, and failing under
  `decoder: "sharp"`: `@variance-authority/cli`.
- The comparison the pixels feed: `png`.

[adr-0013]:
  ../../docs/context/adr/0013-packages-are-named-for-their-requirements.md
