import type { NativeScanner } from '../native.js';
import { nativeRefusal } from '../addon.js';
import type { NativeFoldModules, NativeJourneyModule } from '../native-journey.js';
import type { ModuleId } from '../instrument/index.js';
import { NO_OWNER } from './format-layout.js';
import { NO_LINE } from './written-lines.js';
import type { CapturedModule } from './instrumented-modules.js';

/** A module cut again from the checkout, as the native fold reads it. */
export function nativeModule(module: CapturedModule): NativeJourneyModule {
  const place = new Map(module.blocks.map((block, at) => [block.ordinal, at]));
  return {
    id: module.id,
    file: module.file,
    blocks: module.blocks.map((block) => ({
      kind: block.kind,
      name: block.name,
      path: block.path,
      startLine: block.startLine ?? NO_LINE,
      endLine: block.endLine ?? NO_LINE,
      source: block.source,
    })),
    owners: module.blocks.map((block) => (block.owner === undefined ? NO_OWNER : place.get(block.owner) ?? NO_OWNER)),
  };
}

/** `modules` as the columns a case fold reads them in, each module under its id, the map's key. */
export function foldModules(modules: ReadonlyMap<ModuleId, CapturedModule>): NativeFoldModules {
  let count = 0;
  for (const module of modules.values()) count += module.blocks.length;
  const blocks = new Uint32Array(modules.size + 1);
  const ordinal = new Uint32Array(count);
  const kind = new Uint32Array(count);
  const name = new Uint32Array(count);
  const path = new Uint32Array(count);
  const start = new Uint32Array(count);
  const end = new Uint32Array(count);
  const source = new Uint8Array(count);
  const owner = new Uint32Array(count);
  const strings: string[] = [];
  const held = new Map<string, number>();
  const string = (value: string): number => {
    let at = held.get(value);
    if (at === undefined) {
      at = strings.push(value) - 1;
      held.set(value, at);
    }
    return at;
  };
  const ids: string[] = [];
  const files: string[] = [];
  let at = 0;
  for (const [id, module] of modules) {
    blocks[ids.length] = at;
    ids.push(id);
    files.push(module.file);
    const place = new Map(module.blocks.map((block, index) => [block.ordinal, index]));
    for (const block of module.blocks) {
      ordinal[at] = block.ordinal;
      kind[at] = string(block.kind);
      name[at] = string(block.name);
      path[at] = string(block.path);
      start[at] = block.startLine ?? NO_LINE;
      end[at] = block.endLine ?? NO_LINE;
      source[at] = block.source ? 1 : 0;
      owner[at] = block.owner === undefined ? NO_OWNER : place.get(block.owner) ?? NO_OWNER;
      at += 1;
    }
  }
  blocks[ids.length] = at;
  return { ids, files, blocks, ordinal, kind, name, path, start, end, source, owner, strings };
}

/** What stopped the addon loading, or which export the addon that did load lacks. */
export function whyAbsent(entry: keyof NativeScanner): string {
  return nativeRefusal() ?? `the loaded addon has no \`${entry}\``;
}
