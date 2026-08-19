/**
 * The pixel arm of the head-to-head, with real Chromium screenshots.
 *
 * The claim this repository is sold on is that a semantic verification layer
 * beats a pixel differ. That claim is worth nothing unless the pixel differ is
 * real, so this is the strongest honest version of "usual VR": a persistent
 * Chromium, one screenshot per story per side, `pixelmatch` at its own defaults,
 * and no threshold chosen after seeing the answer.
 *
 * Four things are measured, in one run so they share one browser and one build:
 *
 *   1. what a pixel differ reports for each of the eight mutations — which is a
 *      count of changed screenshots and, structurally, nothing else;
 *   2. whether `mutations.ts`'s declared `visible: false` survives real pixels;
 *   3. flakiness, by diffing a screenshot against itself;
 *   4. the blind-spot probes, where the pixel arm is the one that can see.
 *
 * Run:  yarn build && yarn workspace @variance-authority/example-todomvc pixel
 *       ... --write   also dumps every PNG and diff into `pixel-out/`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '@variance-authority/core';
import { createHarness } from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { MUTATIONS, STORIES } from '../dist/index.js';
import { PROBES } from '../dist/pixel/probes.js';
import { comparePngs, diffImage, DEFAULT_POLICY, STRICT_POLICY } from '../dist/pixel/diff.js';
import { BASELINE_VARIANT, PROBE_PREFIX } from '../dist/pixel/protocol.js';
import { buildAgentBundle, HARNESS_PAGE_URL } from './agent-bundle.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../pixel-out');
const WRITE = process.argv.includes('--write');

const VIEWPORT = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

/** How many times the no-change comparison is repeated. */
const FLAKE_ROUNDS = 5;

/** The element the screenshot is clipped to. See `page/harness.html`. */
const CLIP = '#subject';

const STORY_IDS = STORIES.map((story) => story.id);

// ---------------------------------------------------------------------------
// Driving the page

/**
 * Mount `(subject, variant)` without collecting anything.
 *
 * `harness.capture` would also mount, and would additionally run the semantic
 * collector — work no pixel differ performs. Charging it to this arm would make
 * every wall-clock number below a fabrication, so the runner reaches the agent's
 * render-only entry through the harness's page handle instead.
 */
async function mount(page, subject, variant) {
  const json = await page.evaluate(
    ([global, request]) => window[global].render(request),
    [AGENT_GLOBAL, { subject, variant }],
  );
  const result = JSON.parse(json);
  if (result.height === 0) throw new Error(`${subject}/${variant} mounted with zero height`);
  return result;
}

/** One real `page.screenshot`, clipped to the subject container. */
async function shoot(page) {
  return page.locator(CLIP).screenshot();
}

async function mountAndShoot(page, subject, variant) {
  await mount(page, subject, variant);
  return shoot(page);
}

function write(name, bytes) {
  if (!WRITE) return;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, name), bytes);
}

const safe = (id) => id.replace(/[^a-z0-9]+/gi, '-');

// ---------------------------------------------------------------------------
// The run

const harness = await createHarness({
  url: HARNESS_PAGE_URL,
  bundle: await buildAgentBundle(),
  viewport: VIEWPORT,
  fonts: ['system-ui/400/normal/todomvc'],
});

const page = harness.page;

try {
  // One mount and one screenshot before any clock starts. The first shot pays
  // for Playwright's screenshot pipeline warming up, and charging that to
  // whichever mutation happened to run first would be a measurement of the
  // iteration order.
  await mountAndShoot(page, STORY_IDS[0], BASELINE_VARIANT);
  await harness.capture(STORY_IDS[0], BASELINE_VARIANT);

  // -------------------------------------------------------------------------
  // 1. Where the pixel arm's time goes.
  //
  // Three passes over the same story set, differing in one step each, so the
  // cost of a screenshot can be read as a subtraction rather than asserted. The
  // semantic pass is here for scale only — the semantic arm is scored elsewhere
  // — but it has to be taken on this machine in this process, because journal
  // 0007's 7.5 ms/capture and a screenshot measured on someone else's laptop are
  // not a comparison.
  const cost = { mountMs: 0, shotMs: 0, captureMs: 0, renders: STORY_IDS.length };

  let started = performance.now();
  for (const story of STORY_IDS) await mount(page, story, BASELINE_VARIANT);
  cost.mountMs = performance.now() - started;

  started = performance.now();
  for (const story of STORY_IDS) await mountAndShoot(page, story, BASELINE_VARIANT);
  cost.shotMs = performance.now() - started;

  started = performance.now();
  for (const story of STORY_IDS) await harness.capture(story, BASELINE_VARIANT);
  cost.captureMs = performance.now() - started;

  // -------------------------------------------------------------------------
  // 2. Flakiness — the same render, screenshotted twice, with nothing changed.
  //
  // Measured *before* the mutations, not after, so that the per-story noise
  // recorded here can annotate the mutation results below. A small pixel count
  // is only evidence of a change if it is larger than what the arm produces when
  // nothing changed, and establishing that afterwards would be choosing the
  // noise floor with the answer already in hand.
  //
  // Two flavours, because they answer different questions. `same-mount` shoots
  // twice without touching the page and isolates the screenshot pipeline;
  // `remount` tears the story down, renders something else, renders it back, and
  // shoots again — which is the path every number below went through. A VR tool
  // that is noisy only in the second flavour has a determinism problem in its
  // renderer, not in its camera, and the two are fixed in different places.
  const flake = {
    sameMount: { default: [], strict: [] },
    remount: { default: [], strict: [] },
    /** Worst count any single story reached with nothing changed. */
    perStory: new Map(),
  };
  for (let round = 0; round < FLAKE_ROUNDS; round += 1) {
    const totals = { sameDefault: 0, sameStrict: 0, remountDefault: 0, remountStrict: 0 };
    for (const [index, story] of STORY_IDS.entries()) {
      await mount(page, story, BASELINE_VARIANT);
      const first = await shoot(page);
      const second = await shoot(page);
      const same = comparePngs(first, second);
      totals.sameDefault += same.changed.default;
      totals.sameStrict += same.changed.strict;

      // Somebody else's story in between, so the remount cannot be a no-op the
      // browser optimised away.
      await mount(page, STORY_IDS[(index + 1) % STORY_IDS.length], BASELINE_VARIANT);
      const third = await mountAndShoot(page, story, BASELINE_VARIANT);
      const again = comparePngs(first, third);
      totals.remountDefault += again.changed.default;
      totals.remountStrict += again.changed.strict;

      const worst = flake.perStory.get(story) ?? { default: 0, strict: 0 };
      flake.perStory.set(story, {
        default: Math.max(worst.default, same.changed.default, again.changed.default),
        strict: Math.max(worst.strict, same.changed.strict, again.changed.strict),
      });
    }
    flake.sameMount.default.push(totals.sameDefault);
    flake.sameMount.strict.push(totals.sameStrict);
    flake.remount.default.push(totals.remountDefault);
    flake.remount.strict.push(totals.remountStrict);
  }

  // -------------------------------------------------------------------------
  // 3. Baselines — the golden images a VR tool stores in the repository.
  //
  // Taken once for the whole run, not once per mutation. A real VR run compares
  // a branch against committed goldens; re-shooting them eight times would
  // inflate the pixel arm's cost by 8x with work no honest caller performs.
  const baselineStarted = performance.now();
  const baselines = new Map();
  let baselineBytes = 0;
  for (const story of STORY_IDS) {
    const png = await mountAndShoot(page, story, BASELINE_VARIANT);
    baselines.set(story, png);
    baselineBytes += png.length;
    write(`baseline--${safe(story)}.png`, png);
  }
  const baselineMs = performance.now() - baselineStarted;

  // -------------------------------------------------------------------------
  // 4. Per mutation: shoot every story again and diff against its golden.
  const results = [];
  for (const mutation of MUTATIONS) {
    const shotStarted = performance.now();
    const shots = new Map();
    for (const story of STORY_IDS) {
      shots.set(story, await mountAndShoot(page, story, mutation.id));
    }
    const shotMs = performance.now() - shotStarted;

    const diffStarted = performance.now();
    const perStory = [];
    let bytes = 0;
    for (const story of STORY_IDS) {
      const after = shots.get(story);
      bytes += after.length;
      perStory.push({ story, comparison: comparePngs(baselines.get(story), after) });
    }
    const diffMs = performance.now() - diffStarted;

    const changedDefault = perStory.filter((entry) => entry.comparison.changed.default > 0);
    const changedStrict = perStory.filter((entry) => entry.comparison.changed.strict > 0);

    if (WRITE) {
      for (const { story, comparison } of perStory) {
        if (comparison.changed.default === 0) continue;
        write(`${safe(mutation.id)}--${safe(story)}.png`, shots.get(story));
        write(
          `${safe(mutation.id)}--${safe(story)}--diff.png`,
          diffImage(baselines.get(story), shots.get(story)),
        );
      }
    }

    results.push({
      mutation,
      shotMs,
      diffMs,
      bytes,
      perStory,
      changedDefault: changedDefault.map((entry) => entry.story),
      changedStrict: changedStrict.map((entry) => entry.story),
      pixelsDefault: sum(perStory.map((entry) => entry.comparison.changed.default)),
      pixelsStrict: sum(perStory.map((entry) => entry.comparison.changed.strict)),
      resized: perStory.filter((entry) => entry.comparison.dimensionsChanged).length,
    });
  }

  // -------------------------------------------------------------------------
  // 5. Blind-spot probes — where the pixel arm wins.
  //
  // Each probe is measured on *both* arms, because "the pixel differ catches
  // something we miss" is only a finding if the semantic snapshot is shown to
  // hold. Claiming the blind spot without checking the render hash would be the
  // same unverified assertion this whole exercise exists to replace.
  const probes = [];
  const probeHashes = new Map();
  for (const probe of PROBES) {
    const subject = PROBE_PREFIX + probe.id;
    const before = await mountAndShoot(page, subject, 'before');
    const after = await mountAndShoot(page, subject, 'after');
    const comparison = comparePngs(before, after);

    const beforeSnapshot = normalize(await harness.capture(subject, 'before'));
    const afterSnapshot = normalize(await harness.capture(subject, 'after'));
    probeHashes.set(probe.id, {
      renderHeld: beforeSnapshot.renderHash === afterSnapshot.renderHash,
      structureHeld: beforeSnapshot.structureHash === afterSnapshot.structureHash,
      styleHeld: beforeSnapshot.styleHash === afterSnapshot.styleHash,
    });

    write(`probe--${safe(probe.id)}--before.png`, before);
    write(`probe--${safe(probe.id)}--after.png`, after);
    if (comparison.changed.default > 0) {
      write(`probe--${safe(probe.id)}--diff.png`, diffImage(before, after));
    }
    probes.push({ probe, comparison });
  }

  report({ engine: harness.engine, cost, baselineMs, baselineBytes, results, flake, probes, probeHashes });
  if (harness.pageErrors().length > 0) {
    console.log('  PAGE ERRORS:\n    ' + harness.pageErrors().join('\n    '));
  }
} finally {
  await harness.close();
}

// ---------------------------------------------------------------------------
// Reporting

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

// Function declarations rather than `const` arrows: `report` is called from the
// top-level `try` above, which runs before this section is evaluated, and a
// `const` helper would be in its temporal dead zone at that point.
function ms(value) {
  return `${value.toFixed(0)}ms`;
}
function kib(value) {
  return `${(value / 1024).toFixed(0)}KiB`;
}
function pad(value, width) {
  return String(value).padEnd(width);
}
function num(value, width) {
  return String(value).padStart(width);
}

function report({ engine, cost, baselineMs, baselineBytes, results, flake, probes, probeHashes }) {
  const lines = [];
  const say = (line = '') => lines.push(line);

  say();
  say(`PIXEL ARM — todomvc, ${engine}`);
  say(
    `  ${STORY_IDS.length} stories x ${MUTATIONS.length} mutations, ` +
      `viewport ${VIEWPORT.width}x${VIEWPORT.height}@${VIEWPORT.deviceScaleFactor}x, ` +
      `clip ${CLIP}`,
  );
  say(
    `  baselines (stored once, reused by every mutation): ` +
      `${STORY_IDS.length} shots  ${ms(baselineMs)}  ${kib(baselineBytes)}`,
  );
  say(
    `  policies: default = pixelmatch defaults (threshold ${DEFAULT_POLICY.threshold}, ` +
      `includeAA ${DEFAULT_POLICY.includeAA})` +
      `   strict = threshold ${STRICT_POLICY.threshold}, includeAA ${STRICT_POLICY.includeAA}`,
  );
  say();

  say(`  WHERE THE TIME GOES — ${cost.renders} renders per pass, same stories, same page`);
  say(`  mount only                  ${num(ms(cost.mountMs), 9)}   ${(cost.mountMs / cost.renders).toFixed(1)} ms/story`);
  say(`  mount + screenshot          ${num(ms(cost.shotMs), 9)}   ${(cost.shotMs / cost.renders).toFixed(1)} ms/story`);
  say(`  mount + semantic capture    ${num(ms(cost.captureMs), 9)}   ${(cost.captureMs / cost.renders).toFixed(1)} ms/story`);
  say(
    `  => screenshot ${((cost.shotMs - cost.mountMs) / cost.renders).toFixed(1)} ms,` +
      ` semantic collection ${((cost.captureMs - cost.mountMs) / cost.renders).toFixed(1)} ms,` +
      ` on top of a ${(cost.mountMs / cost.renders).toFixed(1)} ms mount both arms pay`,
  );
  say();

  say('  WHAT A PIXEL DIFFER REPORTS');
  say('  mutation          layer         declared  shots  wall     PNG      changed  diff px      diff px');
  say('                                  visible                            stories  (default)    (strict)');
  for (const result of results) {
    say(
      '  ' +
        pad(result.mutation.id, 18) +
        pad(result.mutation.layer, 14) +
        pad(String(result.mutation.visible), 10) +
        num(STORY_IDS.length, 5) +
        num(ms(result.shotMs + result.diffMs), 8) +
        num(kib(result.bytes), 8) +
        num(`${result.changedDefault.length}/${STORY_IDS.length}`, 9) +
        num(result.pixelsDefault, 13) +
        num(result.pixelsStrict, 13),
    );
  }
  say();
  say('  The "changed stories" column is the entire output. A pixel differ has no');
  say('  cause, no grouping, and no component name to attach to any of it.');
  say();

  say('  GROUND TRUTH CHECK — mutations declared visible: false');
  for (const result of results.filter((entry) => !entry.mutation.visible)) {
    const verdict =
      result.pixelsStrict === 0
        ? 'HELD — pixel-identical, even byte-exact'
        : result.pixelsDefault === 0
          ? 'HELD at the default policy; strict sees antialiasing only'
          : 'REFUTED — real pixels differ';
    say(`  ${pad(result.mutation.id, 18)}${verdict}`);
    say(
      `  ${' '.repeat(18)}changed stories ${result.changedDefault.length}/${STORY_IDS.length}` +
        `   default ${result.pixelsDefault} px   strict ${result.pixelsStrict} px`,
    );
    for (const { story, comparison } of result.perStory) {
      if (comparison.changed.strict === 0) continue;
      // Annotated with what this same story did across the flakiness rounds with
      // nothing changed. Without that column a reader cannot tell a 24-pixel
      // detection from 24 pixels of the arm's own jitter, and the difference
      // decides whether `visible: false` survived.
      const noise = flake.perStory.get(story) ?? { default: 0, strict: 0 };
      say(
        `  ${' '.repeat(20)}${pad(story, 30)}` +
          `default ${num(comparison.changed.default, 6)}   strict ${num(comparison.changed.strict, 6)}` +
          `   of ${num(comparison.total, 7)} px` +
          `   noise ${num(noise.strict, 4)}` +
          (comparison.dimensionsChanged ? '   (resized)' : ''),
      );
    }
  }
  say();

  say('  CAN THE PIXEL DIFFER TELL THE LAYERS APART?');
  for (const result of results) {
    say(
      `  ${pad(result.mutation.id, 18)}${pad(result.mutation.layer, 14)}` +
        (result.changedDefault.length === 0 ? '(nothing changed)' : result.changedDefault.join(' ')),
    );
  }
  const collisions = [];
  for (let i = 0; i < results.length; i += 1) {
    for (let j = i + 1; j < results.length; j += 1) {
      const a = [...results[i].changedDefault].sort().join('|');
      const b = [...results[j].changedDefault].sort().join('|');
      if (a === b) collisions.push([results[i], results[j]]);
    }
  }
  say();
  if (collisions.length === 0) {
    say('  Every mutation produced a distinct set of changed stories.');
  } else {
    for (const [a, b] of collisions) {
      say(
        `  INDISTINGUISHABLE: ${a.mutation.id} (${a.mutation.layer}) and ` +
          `${b.mutation.id} (${b.mutation.layer}) changed exactly the same stories.`,
      );
    }
  }
  say('  A distinct *set* is not an identified cause: the sets are only distinct');
  say('  after a human reads them, and nothing in the output says which layer moved.');
  say();

  say(`  FLAKINESS — ${FLAKE_ROUNDS} rounds over ${STORY_IDS.length} stories, nothing changed`);
  say('                                             default policy      strict policy');
  say(
    `  same-mount (shoot twice, touch nothing):  ${pad(flake.sameMount.default.join(', '), 20)}${flake.sameMount.strict.join(', ')}`,
  );
  say(
    `  remount    (render it again, then shoot): ${pad(flake.remount.default.join(', '), 20)}${flake.remount.strict.join(', ')}`,
  );
  const noisy = [...flake.perStory.entries()].filter(([, worst]) => worst.strict > 0);
  if (noisy.length > 0) {
    say('  stories that moved with no edit at all (worst of any round):');
    for (const [story, worst] of noisy) {
      say(`  ${' '.repeat(4)}${pad(story, 30)}default ${num(worst.default, 5)}   strict ${num(worst.strict, 5)}`);
    }
  }
  // The noise floor is what makes a small `strict` count above readable. A
  // mutation whose strict diff never exceeds this on any story has not been
  // shown to change anything — it has been shown to be inside the arm's own
  // jitter, and quoting it as a detection would be quoting the instrument.
  const floor = sum([...flake.perStory.values()].map((worst) => worst.strict));
  say(`  strict noise floor across the story set: ${floor} px`);
  say();

  say('  BLIND SPOTS — changes the pixel arm sees');
  for (const { probe, comparison } of probes) {
    const hashes = probeHashes.get(probe.id);
    say(
      `  ${pad(probe.id, 18)}${pad(probe.hole, 20)}` +
        `default ${num(comparison.changed.default, 7)} px   strict ${num(comparison.changed.strict, 7)} px`,
    );
    say(
      `  ${' '.repeat(18)}semantic renderHash ${hashes.renderHeld ? 'HELD (we are blind)' : 'MOVED (we caught it)'}` +
        `   structure ${hashes.structureHeld ? 'held' : 'moved'}` +
        `   style ${hashes.styleHeld ? 'held' : 'moved'}`,
    );
    say(`  ${' '.repeat(18)}${probe.intent}`);
  }
  say();
  say('  reproduce: yarn build && yarn workspace @variance-authority/example-todomvc pixel');
  say();

  console.log(lines.join('\n'));
}
