import type { NativeScanner } from '../native.js';
import { nativeRefusal } from '../addon.js';
import type { NativeJourneyModule } from '../native-journey.js';
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

/** What stopped the addon loading, or which export the addon that did load lacks. */
export function whyAbsent(entry: keyof NativeScanner): string {
  return nativeRefusal() ?? `the loaded addon has no \`${entry}\``;
}
