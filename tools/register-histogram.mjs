/**
 * Which words the published pages lean on, and which of them are names.
 *
 * Two sweeps — `moved`, then `reach` — were each started by somebody noticing a
 * word too often. This counts instead of noticing. It reads the published prose
 * with its code fences and its `inline code` removed, so what is left is the
 * writing rather than the product's own vocabulary quoted back, groups words
 * into families (`reach`, `reaches`, `reached`, `reachable` are one row), and
 * asks one question of each family: does this word also appear in the source?
 *
 * That question is the register's own line, condition 4: a hard word is allowed
 * when it is a name and not when it is style. A name is in the code — it is an
 * identifier, a type, a field, a comment at a declaration. `subject`, `baseline`
 * and `crossing` all are. A word that appears three hundred times in the pages
 * and nowhere in the program is carrying no product behind it, and it is the
 * next candidate for a sweep.
 *
 * Usage:
 *   node tools/register-histogram.mjs            # the top of each ranking
 *   node tools/register-histogram.mjs --all      # every family over the floor
 *   node tools/register-histogram.mjs --word=X   # one family, with its files
 *   node tools/register-histogram.mjs --json
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const FLOOR = 12; // a family under this is not a habit yet

/** Files a reader can open: the pages, not the notes that make them. */
function published(files) {
  return files.filter(
    (f) =>
      f === 'README.md'
      || (f.startsWith('docs/')
        && f.endsWith('.md')
        && f !== 'docs/AGENTS.md'
        && f !== 'docs/visual-guidelines.md'
        && !f.startsWith('docs/context/')
        && !f.startsWith('docs/specs/'))
      || /^(packages|examples)\/[^/]+\/README\.md$/.test(f),
  );
}

/** The program: what a name can be a name of. */
function program(files) {
  return files.filter(
    (f) =>
      /^packages\/[^/]+\/(src|skill)\//.test(f)
      && /\.(ts|tsx|rs|mts|mjs|md)$/.test(f)
      && !/\.test\.(ts|tsx)$/.test(f),
  );
}

/** Prose only: a fenced block and an inline span are the product speaking. */
function prose(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/[-:|]/g, ' '));
}

/** camelCase, snake_case and kebab-case all say several words. */
function codeWords(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]/g, ' ')
    .toLowerCase()
    .match(/[a-z]{3,}/g) ?? [];
}

/**
 * One row per family, not per spelling.
 *
 * The stemming is deliberately crude. It only has to put `reaches` beside
 * `reach`, and a wrong grouping is visible in the output rather than silent:
 * the row prints the spellings it collected.
 */
function stem(word) {
  for (const [suffix, keep] of [
    ['ability', 0], ['ibility', 0], ['ations', 0], ['ation', 0], ['ively', 0],
    ['ement', 0], ['ness', 0], ['able', 0], ['ible', 0], ['ing', 0],
    ['edly', 0], ['ies', 'y'], ['ied', 'y'], ['ed', 0], ['es', 0],
    ['ly', 0], ['s', 0],
  ]) {
    if (word.length > suffix.length + 3 && word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length);
      const fixed = keep === 0 ? base : base + keep;
      return fixed.length > 2 && fixed.at(-1) === fixed.at(-2) && !'sl'.includes(fixed.at(-1))
        ? fixed.slice(0, -1)
        : fixed;
    }
  }
  return word;
}

const FUNCTION_WORDS = new Set(
  ('the and that for with what this you your not are was were has have had but any all one two '
    + 'its from can will may must its they them their there then than when where which who whom '
    + 'how why into out over under above below same other each both more most less least only '
    + 'also very just still even now here about after before between during through against '
    + 'because while until since again once such own too say says said see seen does did done '
    + 'been being get got make made take taken give given come came know known think thought '
    + 'want need use used using way ways thing things something nothing anything everything '
    + 'someone anyone everyone nobody somewhere anywhere everywhere never always often '
    + 'sometimes rather instead however therefore thus hence would could should might shall '
    + 'let lets like likely unlike unless whether either neither every few many much several '
    + 'already yet ever else enough quite whose upon among within without across along around '
    + 'behind beside besides beyond despite except inside outside toward towards underneath '
    + 'whatever whenever wherever whichever whoever').split(/\s+/),
);

const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');

/** family -> {prose, code, spellings, files} */
const rows = new Map();
function row(word) {
  const key = stem(word);
  let r = rows.get(key);
  if (r === undefined) {
    r = { key, prose: 0, code: 0, capital: 0, spellings: new Map(), files: new Set() };
    rows.set(key, r);
  }
  return r;
}

let proseWords = 0;
for (const f of published(files)) {
  const page = prose(readFileSync(ROOT + f, 'utf8'));
  for (const hit of page.matchAll(/[A-Za-z]{3,}/g)) {
    const seen = hit[0];
    const w = seen.toLowerCase();
    proseWords += 1;
    if (FUNCTION_WORDS.has(w)) continue;
    const r = row(w);
    r.prose += 1;
    // A capital after a full stop is the sentence starting, not somebody's name.
    const before = page.slice(0, hit.index).trimEnd();
    const opens = before === '' || '.!?:|*-–—'.includes(before.at(-1));
    if (seen[0] !== w[0] && !opens) r.capital += 1;
    r.spellings.set(seen, (r.spellings.get(seen) ?? 0) + 1);
    r.files.add(f);
  }
}

for (const f of program(files)) {
  for (const w of codeWords(readFileSync(ROOT + f, 'utf8'))) {
    if (FUNCTION_WORDS.has(w)) continue;
    row(w).code += 1;
  }
}

const per10k = (n) => (n / proseWords) * 10_000;
const all = [...rows.values()]
  .filter((r) => r.prose >= FLOOR)
  .map((r) => ({
    ...r,
    rate: per10k(r.prose),
    // A word written with a capital most of the time is somebody's name.
    proper: r.capital / r.prose > 0.25,
    // The spelling to print: stemming only has to group, it does not have to read well.
    said: [...r.spellings].sort((a, b) => b[1] - a[1])[0][0].toLowerCase(),
    // 0 when the program never says it, 1 when the program says it as freely.
    named: r.code === 0 ? 0 : Math.min(1, r.code / Math.max(1, r.prose)),
  }));

const unnamed = all
  .filter((r) => r.named < 0.25 && !r.proper)
  .sort((a, b) => b.prose * (1 - b.named) - a.prose * (1 - a.named));
const leaned = [...all].filter((r) => !r.proper).sort((a, b) => b.prose - a.prose);

const argv = process.argv.slice(2);
const one = argv.find((a) => a.startsWith('--word='))?.slice('--word='.length);
const limit = argv.includes('--all') ? Infinity : 30;

if (argv.includes('--json')) {
  process.stdout.write(
    JSON.stringify(
      { proseWords, families: all.map((r) => ({ ...r, spellings: [...r.spellings], files: [...r.files] })) },
      null,
      2,
    ) + '\n',
  );
} else if (one !== undefined) {
  const r = rows.get(stem(one.toLowerCase()));
  if (r === undefined) {
    process.stdout.write(`No family for \`${one}\` in the published pages.\n`);
  } else {
    const spellings = [...r.spellings].sort((a, b) => b[1] - a[1]);
    const shapes = new RegExp(`\\b(${spellings.map(([w]) => w).join('|')})\\b`, 'gi');
    process.stdout.write(
      `${r.key}: ${r.prose} in prose, ${r.code} in the program, ${r.files.size} files\n`
        + `  ${spellings.map(([w, n]) => `${w} ${n}`).join('  ')}\n\n`,
    );
    for (const f of [...r.files].sort()) {
      const page = prose(readFileSync(ROOT + f, 'utf8')).replace(/\s+/g, ' ');
      for (const hit of page.matchAll(shapes)) {
        const from = Math.max(0, hit.index - 58);
        process.stdout.write(
          `  ${f}\n    …${page.slice(from, hit.index + hit[0].length + 58).trim()}…\n`,
        );
      }
    }
  }
} else {
  const bar = (n, max) => '█'.repeat(Math.max(1, Math.round((n / max) * 34)));
  const show = (title, why, list) => {
    const rank = list.slice(0, limit);
    const max = Math.max(...rank.map((r) => r.prose));
    const pad = Math.max(...rank.map((r) => r.said.length));
    process.stdout.write(`\n${title}\n${why}\n\n`);
    for (const r of rank) {
      process.stdout.write(
        `  ${r.said.padEnd(pad)}  ${String(r.prose).padStart(4)}  `
          + `${r.rate.toFixed(1).padStart(5)}/10k  ${String(r.files.size).padStart(3)} files  `
          + `${r.code === 0 ? '  no name' : `${String(r.code).padStart(5)} code`}  ${bar(r.prose, max)}\n`,
      );
    }
  };
  process.stdout.write(
    `${proseWords.toLocaleString()} words of published prose, `
      + `${all.length} families over ${FLOOR}.\n`,
  );
  show(
    'What the pages say most',
    'Every content word, family by family. Read down it and ask of each: is this the '
      + 'literal thing, every time it is written?',
    leaned,
  );
  show(
    'Said often, and not a name',
    'The program never says these, or barely — so there is no page that owns them and '
      + 'nothing to learn. Style rather than vocabulary.',
    unnamed,
  );
}
