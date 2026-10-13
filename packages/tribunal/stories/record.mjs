/**
 * What tribunal's stories show, recorded from the product rather than written
 * for it.
 *
 * A story about a review surface is only as honest as the build it reviews. A
 * hand-written `BuildDetail` says what its author remembered the service
 * answering, and it keeps saying it after the service changes. So the data here
 * is made the way an adopter's is: `variance run` photographs
 * `cases/storybook-case` twice — as it is, then with the `wide-button` mutation —
 * `variance push` files both runs with a real tribunal, and a reviewer decides
 * on two of the changes and raises a concern about a third.
 *
 * What it keeps is what was sent: every write, in `recorded/writes.json`, and
 * every pushed image, in `recorded/images`. The answers the stories replay,
 * `recorded/answers.json`, are worked out from those by
 * [`answers.mjs`](./answers.mjs), which `test/recording.test.ts` runs again on
 * every `yarn test` — so the service changing what it answers fails a test, and
 * `vitest -u` on that file writes the new answers without a browser.
 *
 * Run this again when what is sent changes — the case, the run report, the push
 * — and commit what it writes:
 *
 *     yarn build && yarn workspace @variance-authority/tribunal stories:record
 *
 * It launches Chromium and binds a loopback port.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { serveTribunal } from '@variance-authority/tribunal/node';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';
import { createReviewClient } from '@variance-authority/tribunal/ui';
import { createTribunal } from '@variance-authority/tribunal/worker';
import { INGEST, PROJECT, REVIEW, answersOf, imageName } from './answers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const CASE = join(ROOT, 'cases/storybook-case');
const OUT = join(HERE, 'recorded');
const VARIANCE = join(ROOT, 'packages/cli/dist/bin.js');

const REVIEWER = 'marina';

/**
 * The two builds, each with the hour its run is filed at. Fixed, so recording
 * again moves no date on any page that was not otherwise changed.
 */
const BUILDS = [
  { build: 'ci-101', commit: '3f2a9c1', branch: 'main', index: 'storybook-static', at: '2026-06-01T09:00:00.000Z' },
  {
    build: 'ci-102',
    commit: '8d41e07',
    branch: 'feat/wide-button',
    index: 'storybook-changed',
    at: '2026-06-01T10:00:00.000Z',
    intent: 'give the primary button more room',
  },
];

const work = mkdtempSync(join(tmpdir(), 'tribunal-stories-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));

execFileSync('yarn', ['workspace', '@variance-authority/case-storybook', 'build-storybook'], { stdio: 'inherit' });
execFileSync('yarn', ['workspace', '@variance-authority/case-storybook', 'build-storybook:changed'], {
  stdio: 'inherit',
});

// The service's clock is the recording's: each write is stamped with it and
// moves it on a minute, and each push starts it at its build's hour.
let clock = new Date(BUILDS[0].at);
const writes = [];
const files = new Map();
const service = await serve();
const baselines = join(work, 'baselines');

for (const [position, one] of BUILDS.entries()) {
  const config = configFor(one, service.url, baselines);
  // 1 is a run that found something to review, which is what both of these are.
  await variance(['run', '--config', config], [0, 1]);
  fileAt(join(work, one.build, 'run.json'), one);
  clock = new Date(one.at);
  await variance(['push', '--config', config, '--run', one.build, '--commit', one.commit, '--branch', one.branch], [0]);
  if (position < BUILDS.length - 1) await variance(['accept', '--config', config, '--all'], [0]);
}

await review(createReviewClient({ endpoint: service.url, token: REVIEW }));
await service.close();

const recording = { at: clock.toISOString(), writes };
const { answers, images } = await answersOf(recording, (file) => files.get(file), {
  createTribunal,
  createSqliteD1,
  createMemoryR2,
  createReviewClient,
});

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'images'), { recursive: true });
for (const [file, bytes] of files) writeFileSync(join(OUT, 'images', file), bytes);
writeFileSync(join(OUT, 'writes.json'), `${JSON.stringify(recording, null, 2)}\n`);
writeFileSync(join(OUT, 'answers.json'), `${JSON.stringify({ answers, images }, null, 2)}\n`);
process.stdout.write(
  `recorded ${writes.length} writes, ${Object.keys(answers).length} answers and ${files.size} images in ${OUT}\n`,
);
process.exit(0);

/**
 * The service on a loopback port, writing down every write it is sent.
 *
 * In this process rather than the `variance-authority-tribunal` program, so its
 * clock is the recording's. A write is kept as the JSON it carried, with each
 * pushed image swapped for the file it is saved as.
 */
async function serve() {
  const tribunal = createTribunal({
    db: await createSqliteD1(),
    bucket: createMemoryR2(),
    project: PROJECT,
    ingestToken: INGEST,
    reviewToken: REVIEW,
    now: () => clock,
  });
  const keeping = {
    async fetch(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const url = new URL(request.url);
        writes.push({
          at: clock.toISOString(),
          as: capabilityOf(request),
          method: request.method,
          path: `${url.pathname}${url.search}`,
          body: withFiles(await request.clone().json()),
        });
        clock = new Date(clock.getTime() + 60_000);
      }
      return tribunal.fetch(request);
    },
  };
  return await serveTribunal({
    tribunal: keeping,
    host: '127.0.0.1',
    port: 0,
    authorize: capabilityOf,
    tokens: { ingest: INGEST, review: REVIEW },
    ui: false,
  });
}

function capabilityOf(request) {
  const header = request.headers.get('authorization');
  return header === `Bearer ${INGEST}` ? 'ingest' : header === `Bearer ${REVIEW}` ? 'review' : null;
}

/** A push's images, each saved under its digest and named in the write instead of inlined. */
function withFiles(body) {
  if (body.images === undefined) return body;
  const images = {};
  for (const [subject, kinds] of Object.entries(body.images)) {
    images[subject] = {};
    for (const [kind, { bytes, ...rest }] of Object.entries(kinds)) {
      if (bytes === undefined) {
        images[subject][kind] = rest;
        continue;
      }
      const decoded = Buffer.from(bytes, 'base64');
      const file = imageName(decoded);
      files.set(file, decoded);
      images[subject][kind] = { file, ...rest };
    }
  }
  return { ...body, images };
}

/** The case's own config, pointed at one build of its Storybook and at the deployment. */
function configFor(one, endpoint, baselines) {
  const config = JSON.parse(readFileSync(join(CASE, 'variance.config.json'), 'utf8'));
  delete config.share;
  const dir = join(work, one.build);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'variance.config.json');
  const written = {
    ...config,
    subjects: {
      ...config.subjects,
      index: join(CASE, one.index, 'index.json'),
      collector: join(CASE, config.subjects.collector),
    },
    baselines: { kind: 'directory', root: baselines },
    report: join(dir, 'run.json'),
    images: join(dir, 'images'),
    review: { endpoint, token: { env: 'STORIES_INGEST_TOKEN' } },
  };
  writeFileSync(file, `${JSON.stringify(written, null, 2)}\n`);
  return file;
}

/**
 * The CLI, from the repository root, because the collector's source dirs are
 * read from there. Never synchronously: the service it pushes to is this
 * process, and a blocked event loop answers nobody.
 */
async function variance(args, accepted) {
  try {
    await promisify(execFile)(process.execPath, [VARIANCE, ...args], {
      cwd: ROOT,
      env: { ...process.env, STORIES_INGEST_TOKEN: INGEST },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    if (!accepted.includes(error.code)) {
      process.stderr.write(error.stderr ?? '');
      throw error;
    }
  }
}

/** Give a run report the hour and the intent its build is recorded under. */
function fileAt(path, one) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const { intent: _intent, ...rest } = report;
  writeFileSync(path, JSON.stringify({ ...rest, at: one.at, ...(one.intent ? { intent: one.intent } : {}) }));
}

/**
 * A reviewer's pass over the second build: one approval, one rejection, one
 * concern, each on the subject its note is about. A subject the mutation no
 * longer changes stops the recording rather than deciding on something else.
 */
async function review(client) {
  const [, changed] = BUILDS;
  const approve = 'story:case-surface--button-primary';
  const reject = 'story:case-surface--button-secondary';
  const concern = 'story:case-surface--card-rebranded';
  const detail = await client.build(changed.build);
  const pending = new Set(detail.subjects.filter((one) => one.verdict === 'changed').map((one) => one.subject));
  for (const subject of [approve, reject, concern]) {
    if (!pending.has(subject)) throw new Error(`${changed.build} did not change ${subject}, which the review decides on`);
  }
  await client.decide(changed.build, approve, 'approved', REVIEWER, 'the wider padding is the change we asked for');
  await client.decide(changed.build, reject, 'rejected', REVIEWER, 'the secondary button was not meant to move');
  await client.raise({
    build: changed.build,
    subject: concern,
    title: 'Card grows by six pixels when its button does',
    by: REVIEWER,
    note: 'The card follows its content; check whether a fixed height was intended.',
    hypothesis: 'the card has no min-height, so the button padding reflows it',
  });
}
