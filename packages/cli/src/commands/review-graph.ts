// compass: variance-authority/runtime/attention
/**
 * The motion's test files as a diagram for a pull-request comment.
 *
 * The text lists one line per test file, which says how many regions each one
 * gained and lost and not where they are. A comment renders Mermaid, so the
 * same counts are drawn as edges: a test file on the left, the directory of
 * the code on the right, a solid edge for the functions it now enters and a
 * dotted one for those it no longer enters. Every count is a count of
 * functions, the same count the text gives, and the text stays below it.
 */

import { dirname } from 'node:path';
import type { MovedRegion, TestFileMotion } from '@variance-authority/sense/test-selection';

/** Past this many directories the diagram draws the first two segments of each path instead. */
const DIRECTORIES = 12;
/** Past this many edges the heaviest are drawn and the rest are counted. */
const EDGES = 30;

interface Edge {
  readonly test: string;
  readonly directory: string;
  readonly entered: number;
  readonly left: number;
}

/** The diagram, or nothing when no test file's reach changed. */
export function motionGraph(testFiles: readonly TestFileMotion[]): readonly string[] {
  if (testFiles.length === 0) return [];
  const sources = testFiles.flatMap((test) => [...test.entered, ...test.left]);
  const directories = new Set(sources.map((region) => dirname(region.file)));
  const where = directories.size > DIRECTORIES
    ? (file: string) => file.split('/').slice(0, 2).join('/')
    : (file: string) => dirname(file);
  const all = testFiles.flatMap((test) => edgesOf(test, where));
  if (all.length === 0) return [];
  const edges = [...all].sort((a, b) => b.entered + b.left - (a.entered + a.left) || order(a.test, b.test) || order(a.directory, b.directory));
  const drawn = edges.slice(0, EDGES);
  const ids = new Map<string, string>();
  const id = (prefix: string, name: string) => {
    const key = `${prefix}\0${name}`;
    let held = ids.get(key);
    if (held === undefined) ids.set(key, (held = `${prefix}${ids.size}`));
    return held;
  };
  const lines = ['', "🔀 Where each test file's reach moved, counted in functions: a solid edge for what it now enters, a dotted one for what it no longer enters.", '', '```mermaid', 'flowchart LR'];
  const declared = new Set<string>();
  const node = (prefix: string, name: string) => {
    const at = id(prefix, name);
    if (declared.has(at)) return at;
    declared.add(at);
    return `${at}["${label(name)}"]`;
  };
  for (const edge of drawn) {
    if (edge.entered > 0) lines.push(`  ${node('t', edge.test)} -- "+${functions(edge.entered)}" --> ${node('d', edge.directory)}`);
    if (edge.left > 0) lines.push(`  ${node('t', edge.test)} -. "−${functions(edge.left)}" .-> ${node('d', edge.directory)}`);
  }
  lines.push('```');
  if (edges.length > drawn.length) lines.push('', `${edges.length - drawn.length} more test file and directory pairs are listed in the fold below.`);
  return lines;
}

/** One edge per directory a test file's reach changed in, counted in functions. */
function edgesOf(test: TestFileMotion, where: (file: string) => string): readonly Edge[] {
  const count = (regions: readonly MovedRegion[]) => {
    const by = new Map<string, Set<string>>();
    for (const region of regions) {
      const directory = where(region.file);
      const name = `${region.file}\0${region.kind === 'module' || region.name === '' ? '' : region.name.split('/')[0]}`;
      const held = by.get(directory);
      if (held === undefined) by.set(directory, new Set([name]));
      else held.add(name);
    }
    return by;
  };
  const entered = count(test.entered);
  const left = count(test.left);
  return [...new Set([...entered.keys(), ...left.keys()])].map((directory) => ({
    test: test.file,
    directory,
    entered: entered.get(directory)?.size ?? 0,
    left: left.get(directory)?.size ?? 0,
  }));
}

function functions(count: number): string {
  return `${count} function${count === 1 ? '' : 's'}`;
}

/** A label Mermaid reads as text: its quote and its markup characters written as entities. */
function label(text: string): string {
  return text.replace(/["<>]/gu, (character) => `#${character.charCodeAt(0)};`);
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
