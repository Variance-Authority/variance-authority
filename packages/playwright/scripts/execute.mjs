#!/usr/bin/env node

/**
 * What an engine costs to *run* a suite, as opposed to photograph one.
 *
 * `paint` prices the raster and finds WebKit roughly twice Chromium's speed
 * under reuse. It is tempting to read that as an engine ranking and choose
 * WebKit for the test run and Chromium only for the baseline. This measures
 * whether that follows, and on the machine this was written on it does not.
 *
 * Four shapes, because "faster at JavaScript" is four questions:
 *
 *   launch  — process start to the first script's answer. What an ephemeral
 *             runner pays before it has done any work, and the regime a
 *             fast-starting engine is supposed to win.
 *   cold    — a fresh context, then one modest script: parse and baseline
 *             execution with no tier-up behind it. Measured per context rather
 *             than per process, so `launch` is not counted twice.
 *   numeric — a hot arithmetic loop. Steady-state throughput, optimizer in.
 *   string  — object churn through JSON, the allocation-bound shape.
 *   dom     — building and measuring 2,000 elements forty times. What a
 *             component test actually does, and the only shape here that is
 *             the engine's DOM rather than its interpreter.
 *
 * Every shape is timed by `performance.now()` *inside the page*, so the
 * protocol round trip is outside the number. `launch` is the exception and has
 * to be: the round trip is the thing being measured.
 *
 * Engines are declared, not discovered — `DECLARED_ENGINES` in `src/engines.ts`,
 * `VARIANCE_ENGINES` to override, and a declared engine that is not installed
 * stops the run rather than quietly reporting one engine's numbers as a
 * comparison.
 *
 * This is Playwright's WebKit build, which is not Safari: the same engine
 * family, configured and shipped by somebody else.
 *
 * Run:  yarn workspace @variance-authority/playwright execute
 *       yarn workspace @variance-authority/playwright execute --json
 */
import { ENGINE_TYPES, declaredEngines, requireEngines } from '../dist/engines.js';

const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];

/**
 * Bodies as source text rather than functions, so nothing this file's own
 * bundler or Node's optimizer has touched crosses into the page.
 */
const SHAPES = {
  cold: `
    let h = 0;
    for (let i = 0; i < 2e5; i++) h = (h * 31 + i) | 0;
    const o = [];
    for (let i = 0; i < 5e3; i++) o.push({ id: i, name: 'n' + i, on: i % 2 === 0 });
    return JSON.parse(JSON.stringify(o)).length + h;`,
  numeric: `
    let s = 0;
    for (let i = 1; i < 3e7; i++) s += Math.sqrt(i) / i;
    return s;`,
  string: `
    let n = 0;
    for (let r = 0; r < 300; r++) {
      const o = [];
      for (let i = 0; i < 2e3; i++) o.push({ id: i, name: 'component-' + i, props: { a: i, b: 'x'.repeat(8) } });
      n += JSON.parse(JSON.stringify(o)).length;
    }
    return n;`,
  dom: `
    for (let r = 0; r < 40; r++) {
      const root = document.createElement('div');
      for (let i = 0; i < 2e3; i++) {
        const el = document.createElement('span');
        el.className = 'cell c' + (i % 7);
        el.textContent = 'row ' + i;
        root.appendChild(el);
      }
      document.body.appendChild(root);
      void root.getBoundingClientRect().height;
      root.remove();
    }
    return 0;`,
};

const timed = (body) => `(() => { const t = performance.now(); (() => {${body}})(); return performance.now() - t; })()`;

const args = process.argv.slice(2);
const json = args.includes('--json');
const rounds = Number(args.find((argument) => /^\d+$/.test(argument)) ?? 7);

let engines;
try {
  engines = requireEngines(declaredEngines());
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
}

const results = {};

for (const name of engines) {
  const launches = [];
  for (let round = 0; round < Math.min(rounds, 5); round++) {
    const started = now();
    const browser = await ENGINE_TYPES[name].launch();
    const page = await browser.newPage();
    await page.evaluate('1 + 1');
    launches.push(now() - started);
    await browser.close();
  }

  const browser = await ENGINE_TYPES[name].launch();

  // A fresh context per sample, because an optimizer tier-up survives inside one
  // page: reusing it would measure the fourth run and print it as the first.
  const colds = [];
  for (let round = 0; round < rounds; round++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    colds.push(await page.evaluate(timed(SHAPES.cold)));
    await context.close();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  const hot = {};
  for (const shape of ['numeric', 'string', 'dom']) {
    const samples = [];
    for (let round = 0; round < rounds; round++) samples.push(await page.evaluate(timed(SHAPES[shape])));
    // The first two are the warm-up this shape is explicitly not measuring.
    hot[shape] = median(samples.slice(2));
  }
  await context.close();
  await browser.close();

  results[name] = { launch: median(launches), cold: median(colds), ...hot };
}

const ms = (value) => value.toFixed(1).padStart(7);

if (json) {
  console.log(JSON.stringify({ rounds, results }, null, 2));
} else {
  console.log(`\n${rounds} rounds per shape, median, timed inside the page except \`launch\`\n`);
  console.log('engine       launch     cold   numeric    string       dom');
  for (const [name, result] of Object.entries(results)) {
    console.log(
      `${name.padEnd(11)} ${ms(result.launch)}  ${ms(result.cold)}  ${ms(result.numeric)}` +
        `  ${ms(result.string)}  ${ms(result.dom)}`,
    );
  }
  console.log(
    '\nms. `launch` is a whole process: start, open a page, get one answer back.\n' +
      'The other four are the page executing code it was already given.\n',
  );
}
