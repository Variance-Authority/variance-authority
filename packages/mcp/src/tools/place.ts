import type { Landmark, RunReport } from '@variance-authority/report';
import { partsOf } from './locate-index.js';
import { readQuestion } from './question.js';
import { orientIndexOf } from './holds.js';
import { deepestUnder, enclosing } from './containment.js';
import { anchors } from './orient.js';
import { scopeLine } from './scope.js';
import type { Orientation, Oriented } from './orient.js';

/**
 * A landmark as somewhere to go.
 *
 * The answer is a file and a line, and that is the difference worth the whole
 * mechanism: every other tool here hands back an id to look something up with,
 * and somebody who asked where the warning is wanted the place it is written.
 * Where the build kept no line, the component that owns it and the files
 * declaring that component are still a source to open.
 */
/**
 * Where a landmark is declared, in one phrase.
 *
 * Two different facts, and the answer says which it has. A run built with the
 * JSX-source plugin knows the line the element itself was written on. A run off
 * a production build — every built Storybook — knows only which component owns
 * it, and which files declare that component. The second is a place to open,
 * not a coordinate, and printing it as though it were the first would be a lie
 * about a line number.
 */
function declaredAt(landmark: Landmark, declaredIn: Declared): string {
  if (landmark.file !== undefined) {
    return ` · ${landmark.file}${landmark.line === undefined ? '' : `:${landmark.line}`}`;
  }
  if (landmark.component === undefined) return '';
  const files = declaredIn[landmark.component] ?? [];
  if (files.length === 0) return ` · in \`${landmark.component}\``;
  return ` · in \`${landmark.component}\` · ${files.slice(0, FILES_SHOWN).join(', ')}`;
}

/** Component → the files declaring it, off the report. Empty when none was read. */
type Declared = Readonly<Record<string, readonly string[]>>;

/** How many declaring files a place prints before the rest are left out. */
const FILES_SHOWN = 2;

/** One landmark as a place: what it is, what it says, and where it is declared. */
function placeOf(landmark: Landmark, declaredIn: Declared = {}): string {
  const said =
    landmark.name !== undefined
      ? `\`${landmark.name}\``
      : landmark.text !== undefined
        ? `“${landmark.text}”`
        : '(unnamed)';
  const role = landmark.role === undefined ? '' : `${landmark.role} `;
  const at = declaredAt(landmark, declaredIn);
  const handle = landmark.handle === undefined ? '' : ` · testid \`${landmark.handle}\``;
  return `${role}${said}${handle}${at}`;
}

/**
 * The arrangement half of an answer, printed.
 *
 * Here the place is the whole answer rather than a line beside an id: a word
 * search hands back ids because a wrong top hit there costs one more call,
 * while an orientation question *is* the place. A reader who has to ask a
 * second tool where the warning is has not been oriented.
 */
export function renderOrientation(answer: Orientation, limit: number): string {
  const { asked } = answer;
  const declaredIn = answer.declaredIn ?? {};
  const relation = asked.relation ?? 'inside';
  const said = `\`${asked.target.join(' ')}\` ${relation} \`${asked.anchor.join(' ')}\``;

  if (answer.refused !== undefined) return `Cannot answer ${said}: ${answer.refused}`;

  // Said before the count either way, because how many surfaces were put to the
  // question is the first thing that makes a nil answer readable.
  const scope = answer.scope === undefined ? '' : `\n${scopeLine(answer.scope, answer.surfaces)}`;

  if (answer.hits.length === 0) {
    return (
      `No surface of ${answer.surfaces} puts ${said}. ` +
      `${answer.considered} surface(s) said the anchor's words; none had anything ${relation} it.${scope}`
    );
  }

  const sections = [
    `${answer.hits.length} surface(s) of ${answer.surfaces} put ${said}, ${answer.considered} read in full.${scope}`,
  ];

  for (const hit of answer.hits.slice(0, limit)) {
    const lines = [
      `${hit.subject}${hit.example === undefined ? '' : ` · example of ${hit.example}`}`,
      `  anchor: ${placeOf(hit.anchor, declaredIn)}`,
    ];
    if (hit.target !== undefined) {
      const how = hit.targetMatched
        ? 'matched on its words'
        : // Nothing on the screen said `warning`. Saying so is the whole of the
          // honesty here: the place is observed, the naming is the reader's.
          `nothing there says ${asked.target.map((word) => `\`${word}\``).join(', ')} — matched on place`;
      const apart = hit.apart === undefined ? '' : `, ${hit.apart}px away`;
      lines.push(`  ${relation}${apart}: ${placeOf(hit.target, declaredIn)} (${how})`);
    }
    if (hit.alsoThere.length > 0) {
      lines.push(
        `  also ${relation}: ${hit.alsoThere
          .slice(0, 3)
          .map((landmark) => placeOf(landmark, declaredIn))
          .join(' · ')}`,
      );
    }
    if (hit.within.length > 0) {
      lines.push(`  within: ${hit.within.map((landmark) => landmark.name ?? landmark.role ?? '…').join(' › ')}`);
    }
    sections.push(lines.join('\n'));
  }

  const rest = answer.hits.length - limit;
  if (rest > 0) sections.push(`…and ${rest} more surface(s).`);

  const top = answer.hits[0]!;
  sections.push(
    `next: variance_composition {subject: "${top.subject}"} · variance_describe {subject: "${top.subject}"}`,
  );
  return sections.join('\n\n');
}

/**
 * Where on each named surface the query's own words are, one line per subject.
 *
 * The first five minutes of a task is not a relation question. It is *the
 * assignee warning* — four words, no grammar — and what the reader needs back
 * is a file, not a second id to spend a call on. The landmark saying those
 * words is already in the record the subject search just read, so this prints
 * it beside the id rather than letting the reader discover the run knew.
 *
 * Only subjects asked for are read. The rarity the ranking uses is still the
 * whole suite's, because how rare a word is is a fact about the suite and not
 * about the eight rows being printed.
 */
export function placesOn(
  report: RunReport,
  subjects: readonly string[],
  query: string,
): ReadonlyMap<string, string> {
  const index = orientIndexOf(report);
  if (index.surfaces === 0) return new Map();

  const asked = readQuestion(query);
  const parts = [...asked.target, ...asked.anchor].flatMap((word) => partsOf(word));
  if (parts.length === 0) return new Map();

  const rarity = (part: string): number =>
    Math.floor((1000 * (index.surfaces - (index.holders.get(part) ?? 0) + 1)) / (index.surfaces + 1));

  const wanted = new Set(subjects);
  const declaredIn = report.lexicon?.declaredIn ?? {};
  const places = new Map<string, string>();
  for (const row of index.rows) {
    if (!wanted.has(row.subject)) continue;
    const landmarks = row.landmarks ?? [];
    const candidates = anchors(landmarks, parts, rarity);
    const best = candidates[0];
    if (best === undefined) continue;
    const at = deepestUnder(landmarks, candidates, best.at);
    const within = enclosing(landmarks, at)
      .map((landmark) => landmark.name ?? landmark.text)
      .filter((said): said is string => said !== undefined);
    places.set(
      row.subject,
      `${placeOf(landmarks[at]!, declaredIn)}${within.length === 0 ? '' : ` · within ${within.join(' › ')}`}`,
    );
  }
  return places;
}
