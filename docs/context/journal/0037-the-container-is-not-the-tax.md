# Journal 0037 — The container is not the tax, the host is

**Date:** 2026-08-31

> **The timings in this entry are superseded by journal 0038.** They carry a
> ~30 ms per-subject constant that is Playwright's actionability wait rather than
> the engine, which flatters every ratio taken across hosts. "A container costs
> nothing measurable per paint" is the artefact: measured on the paint alone it
> costs Chromium 1.17× and WebKit 1.66×, while Firefox is *faster* in the
> container at 0.90×. The raster and
> baseline-interchangeability findings are unaffected.

Two questions, asked together because they are usually answered together and
should not be. **What does the standard Playwright image cost?** — the working
guess was around twice native. And **can a Mac reproduce CI's pixels by running
CI's image?** — which is what "just run it in a container" is really proposing.

The first answer is that the guess was too pessimistic by roughly a factor of
two: on Apple silicon, a Linux container costs **nothing measurable per paint**.
The second is that it works completely, for a reason that has nothing to do with
the container and everything to do with the image: the raster is a property of
the userland, not of the machine or the instruction set. And the corollary is the
uncomfortable half — a macOS baseline and a container baseline are not
interchangeable, and no launch flag makes them so.

## The reproduction

```bash
yarn workspace @variance-authority/playwright host 40 --out ./native
```

```bash
docker run --rm --ipc=host --user pwuser -v "$PWD/box:/work" -w /work \
  -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  mcr.microsoft.com/playwright:v1.62.1-noble \
  sh -c 'npm i playwright@1.62.1 >/dev/null && node host.mjs 40 --out out'
```

```bash
yarn workspace @variance-authority/playwright host --compare ./native ./box/out
```

`scripts/host.mjs` is the only file the container is given, and it imports
nothing from this repository — that is the whole design. A cross-host comparison
run from two different scripts measures the scripts. Add `--platform linux/amd64`
to the middle command for the translated arm, `--font <file>` to both to remove
typeface choice from the comparison, and `--args` to pass Chromium the
rasterization flags.

`--ipc=host` because Chromium's default `/dev/shm` in a container is 64 MB and it
crashes rather than slows down. `--user pwuser` because Chromium's sandbox
refuses to run as root, and the alternative — `--no-sandbox` — would make the
container arm differ from the native arm in a launch argument, which is the one
confound this measurement cannot afford.

Host: Apple M4 Max, 16 cores, 64 GB, macOS 15.5. Container runtime: Docker Desktop
29.0.1, Virtualization.framework, a 16-CPU 8 GB `linux/aarch64` VM. Playwright
1.62.1 and node 26.7.0 natively against 1.62.1 and node 24.18.1 in the image, so
the browser builds are the same builds and the node versions are not.

## A container costs nothing per paint, and something per process

Median milliseconds per paint, 60 paints per arm, the two hosts run back to back,
`reuse` holding one context and one page and `isolate` opening and closing one per
paint:

| engine   | macOS reuse | docker reuse | ratio | macOS isolate | docker isolate | ratio |
| -------- | ----------: | -----------: | ----: | ------------: | -------------: | ----: |
| chromium |        63.3 |         66.8 | 1.06× |          98.5 |          100.2 | 1.02× |
| firefox  |        33.4 |         33.7 | 1.01× |         150.3 |          149.4 | 0.99× |
| webkit   |        33.3 |         36.3 | 1.09× |         181.7 |          127.0 | 0.70× |

Every figure in a `docker` column is Docker Desktop 29.0.1 running
`mcr.microsoft.com/playwright:v1.62.1-noble`. It is the only runtime measured
anywhere in this entry — Apple's `container` needs macOS 26 and this host is 15.5,
so the section on it below carries no numbers and says so.

An earlier 40-paint pair gave 1.00×, 1.05× and 1.22×, so the honest reading of the
reuse penalty is **under 10% with a run-to-run spread about as large as the
penalty itself**. Nothing here is 2×, and the direction is not always positive:
WebKit's isolate arm is consistently *faster* in the container across every run.
The reason there is no penalty to find is that there is no emulation — Docker
Desktop runs an arm64 Linux guest on an arm64 host through
Virtualization.framework, so the browser is native code either way and what is
virtualized is the kernel it syscalls into.

**Launch is not measured well by this benchmark and should not be quoted from it.**
Chromium's launch ranged 89–223 ms native and 54–399 ms in the container across
four runs — the spread is larger than the difference, because the first launch on
either host pays page-cache and code-signing costs the next one does not. It is
also paid once per session rather than per subject, which is why the reuse column
is the one that decides anything.

## Emulation taxes the process, not the paint

Running the amd64 image on the same machine, translated:

| engine   | reuse | vs macOS | isolate | vs macOS | isolation tax |
| -------- | ----: | -------: | ------: | -------: | ------------: |
| chromium |  81.2 |    1.21× |   721.3 |    7.5×  |         8.9×  |
| firefox  |  49.8 |    1.49× |   901.1 |    5.9×  |        18.1×  |
| webkit   |  43.7 |    1.31× |  1255.5 |    7.4×  |        28.7×  |

Same Docker Desktop, same image, `--platform linux/amd64`. 15 paints per arm
rather than 40, because the isolate arm takes a second per subject.

Both `rosetta` and `qemu-x86_64` are registered in the VM's `binfmt_misc`; a paint
that costs 1.2× rules out QEMU's interpreter, so this is Rosetta translating
x86-64 in the Linux guest.

The shape of it is the argument for reuse restated in a harsher accent. Under the
model we run, x86 translation costs 21–49% — annoying, survivable. Under
Playwright's own fixture it costs 6–7×, and the isolation tax rises from 1.4–5.1×
native to **8.9–28.7×**. Translation is expensive at process creation and cheap in
steady-state execution, so a harness that creates a process per subject pays it on
every subject. A run that reuses pays it once.

WebKit is the extreme in both directions, and consistently: it is the fastest
painter and the most expensive context, so it gains the most from reuse and loses
the most without it.

## The engine outranks the host, and outranks the emulator

Put the two findings beside each other and the ordering is not the one anybody
argues about. Under reuse, per paint:

> Re-measured in 0038 without the constant. The partition by engine survives;
> these magnitudes do not.

| arrangement                        |      ms | vs native Chromium |
| ---------------------------------- | ------: | -----------------: |
| WebKit, native macOS               |    33.3 |              1.90× |
| Firefox, native macOS              |    33.4 |              1.89× |
| Firefox, docker arm64              |    33.7 |              1.88× |
| WebKit, docker arm64               |    36.3 |              1.74× |
| WebKit, docker amd64 (translated)  |    43.7 |              1.45× |
| Firefox, docker amd64 (translated) |    49.8 |              1.27× |
| **Chromium, native macOS**         |**63.3** |              1.00× |
| Chromium, docker arm64             |    66.8 |              0.95× |
| Chromium, docker amd64             |    81.2 |              0.78× |

The table **partitions perfectly by engine**. Every non-Chromium arrangement, on
any host, beats every Chromium arrangement — the slowest Firefox or WebKit reading
here is 49.8 ms, translated x86 in a container, and the *fastest* Chromium reading
is 63.3 ms on the bare metal. Neither the host nor the emulator moves an engine
across that line, because the gap they open is 6–30% and the gap between engines
is 90%.

So **WebKit inside an x86 container, translated instruction by instruction, paints
faster than Chromium does natively**. Anyone choosing Chromium on the metal to
avoid a container's overhead has traded a 6% cost for a 74% one, and anyone
choosing Chromium *in* the container has taken both.

The two translated rows come from a 15-paint run rather than a 60-paint one,
because the isolate arm at that size takes a second per subject; they are the
loosest numbers in the table and they are also the ones with the most room to
spare.

The caveat is the one this whole entry is about: it holds under **reuse**. Under
isolation the ranking inverts back — native Chromium's 98.5 ms beats containerized
WebKit's 127 ms, and under translation nothing survives at all. The engine only
outranks the host once the harness has stopped charging every subject for a
process.

## The image decides the pixels, and the architecture does not

The same image, run as arm64 and again as translated amd64, produces **byte-
identical PNGs** on all three engines — the same digests, with the block metric
reporting 0% area and 0% peak because there is nothing to report. It holds for
the host-font page and for a page carrying its own font.

That is the finding that makes containerized recording work at all. The raster is
not a property of the CPU; it is a property of the userland in the image —
FreeType, fontconfig, the font files, and the browser build. Ship the same image
and you get the same pixels, and a developer on an Apple laptop can record a
baseline that a Linux CI runner will reproduce exactly.

## Two hosts do not agree, and the disagreement starts before rasterization

Compare macOS against the container directly and the metric refuses to run:

| engine   | macOS   | docker  |
| -------- | ------- | ------- |
| chromium | 455×181 | 424×181 |
| firefox  | 454×181 | 441×181 |
| webkit   | 455×181 | 424×181 |

The subject asks for `system-ui`, and the two hosts answer with different
typefaces — SF on macOS, whatever the image's fontconfig picks. The box is 31 px
narrower. This is not an antialiasing difference to be absorbed by a tolerance;
it is different text.

Give both hosts the same outlines — the page carries Liberation Sans as a data
URI, so neither host chooses — and the geometry survives on Chromium once
hinting is off, and on nothing else:

| engine   | macOS   | docker  | agreement at 1×1 | at 4×4          |
| -------- | ------- | ------- | ---------------- | --------------- |
| chromium | 433×181 | 433×181 | 6.83% / 56.84%   | 12.64% / 14.41% |
| firefox  | 452×181 | 450×181 | geometry differs | —               |
| webkit   | 455×181 | 433×181 | geometry differs | —               |

Firefox is 2 px apart, WebKit 22 px. Same outlines, same size, same engine build:
what is left is CoreText and FreeType rounding advances differently, and there is
no flag for it on either of those engines.

The Chromium row is the one that can be read, and it reads the way journal 0036
taught us to read this metric. Area 12.64% with peak 14.41% at 4×4 is broad and
shallow — the signature of host noise, sitting under the 33.22% peak that
separated engines and far under the 83.11% floor of a real regression. At 1×1 the
peak is 56.84%, which is why a pixel comparator would call this a catastrophe: the
difference is everywhere a glyph edge falls and nowhere else.

So the discriminator does the right thing, and the operational answer is still
no. **Baselines belong to a host.** The environment key already carries `platform`
and a rasterization digest, so macOS and container baselines cannot silently
collide — they miss, and a miss is a re-record rather than a false green. That is
the safe failure, not a solution: the solution is to record where you compare.

## The flag that is dormant here is load-bearing there

Journal 0036 recorded that macOS emits no subpixel antialiasing from any engine
and that all four Chromium rasterization flags move zero pixels — macOS dropped
subpixel AA in 10.14, so there is nothing for them to switch off.

In the container the same flags are the difference between a comparable raster and
an incomparable one. Chromium painting the pinned webfont emits **6,662 chromatic
pixels** — text with coloured fringes, painted for one LCD's stripe order.
`--disable-lcd-text --font-render-hinting=none` takes that to **zero**, and moves
the box from 436 px to 433 px, because turning hinting off changes advance widths
as well as coverage.

Passing the same flags leaves Firefox and WebKit at 0% area and 0% peak, which is
the check that they are Chromium-only rather than the claim that they are.

`CHROMIUM_RASTER_ARGS` is therefore not belt-and-braces. It is inert on the
machine most of us develop on and it is the thing standing between a CI raster and
a coloured-fringe raster on the machine that records the baselines.

## Apple's `container` runs Linux, which is the point

Apple's `container` — Swift, one lightweight VM per container instead of Docker's
one shared VM, sub-second starts — consumes and produces standard OCI images and
runs **Linux** guests. It is not a way to containerize macOS, and there is no such
way; macOS has no namespace-and-cgroup story for its own userland.

For this question that is the good news rather than the bad. Because the pixels
follow the image and not the machine, and Apple's tool runs the same image, it
would reproduce CI's raster exactly — the same way Docker Desktop already does
above. What it offers over Docker Desktop is start-up and isolation, not fidelity,
and the numbers above say fidelity was never the problem and per-paint cost was
never the problem either. It also uses Rosetta rather than QEMU for amd64, which
is what the translated arm above was already getting.

It requires macOS 26 and Apple silicon; it installs on macOS 15 with significant
limitations, particularly networking. This host is macOS 15.5, so this is read
rather than measured, and it is the one claim here with no number behind it.

## What this does not measure

Only this machine, and only one image. A CI runner is a different core count,
a different memory ceiling and usually a shared one; the ratios should hold and
the absolute numbers should not.

Only `mcr.microsoft.com/playwright:v1.62.1-noble`. "Same image reproduces the same
pixels" is a claim about that image against itself across two architectures. A
different base, a different font package, or an image that installs fonts at build
time is a different userland and therefore a different raster — which is the same
sentence as the finding, pointed the other way.

Nothing here says which host should hold the baselines. It says they belong to
one host, that the choice is between a container everywhere and macOS everywhere,
and that the container costs nothing per paint to choose.
