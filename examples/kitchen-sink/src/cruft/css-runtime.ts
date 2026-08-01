/**
 * A ~40-line stand-in for emotion / styled-components / CSS Modules.
 *
 * Why not use a real one: the perturbation we need is "the hash segment of every
 * generated class name changes while every declaration stays byte-identical".
 * With a real library that is produced by *unrelated* edits — adding a rule to a
 * sibling component, bumping the library, changing the babel plugin's file-name
 * input — none of which is something a test can ask for directly or reproduce
 * deterministically across versions. Here it is a parameter (`salt`), so the
 * corpus can state its ground truth ("only the names moved") as a fact about how
 * the fixture was constructed rather than as a hopeful reading of library output.
 *
 * It reproduces the three properties of real CSS-in-JS that matter to ADR-0003:
 *
 * - class names are opaque hashes with a conventional prefix (`css-1x2y3z`);
 * - rules are injected into a single `<style>` tag at render time, in render
 *   order, so the tag *accretes* rules for everything rendered since page load;
 * - the hash depends on more than the declarations it names, so a name can change
 *   with no change in resolved style. That is the false-invalidation engine the
 *   normalizer has to defuse, and it is the entire reason class attributes are
 *   dropped from the snapshot rather than pattern-matched.
 */

import { createContext, useContext } from 'react';
import { SHEET_MARKER } from '../styles/sheets.js';

/** FNV-1a. Not cryptographic; it only needs to be stable and to scatter. */
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export interface CssRuntime {
  /** Registers a declaration block and returns the generated class name. */
  readonly css: (declarations: string) => string;
  /** Rules emitted so far, in injection order. Lets a fixture assert accretion. */
  readonly rules: () => readonly string[];
}

/**
 * @param salt   Anything that is not the declarations. Changing it renames every
 *               class without touching a single declaration — the no-op refactor
 *               the `hash-stable` cases are built on.
 * @param sheet  Style element to accrete into. Sharing one across subjects
 *               reproduces the "previously rendered story left its rules behind"
 *               condition (ADR-0003, CSS accumulation).
 */
export function createCssRuntime(salt: string, sheet: HTMLStyleElement): CssRuntime {
  const names = new Map<string, string>();
  const emitted: string[] = [];

  function css(declarations: string): string {
    const existing = names.get(declarations);
    if (existing !== undefined) return existing;
    const name = `css-${hash(`${salt}|${declarations}`)}`;
    names.set(declarations, name);
    const rule = `.${name}{${declarations}}`;
    emitted.push(rule);
    sheet.textContent = `${sheet.textContent ?? ''}${rule}\n`;
    return name;
  }

  return { css, rules: () => emitted };
}

/** A runtime that emits nothing, so a component rendered outside a fixture (a
 * Playwright page that forgot to wrap it, say) fails visibly rather than silently
 * losing its styling. */
const INERT: CssRuntime = {
  css: () => 'css-uninitialized',
  rules: () => [],
};

export const CssRuntimeContext = createContext<CssRuntime>(INERT);

export function useCss(): (declarations: string) => string {
  return useContext(CssRuntimeContext).css;
}

/** Creates the accreting `<style>` tag the runtime writes into. */
export function createRuntimeSheet(doc: Document): HTMLStyleElement {
  const el = doc.createElement('style');
  el.setAttribute(SHEET_MARKER, 'css-runtime');
  doc.head.appendChild(el);
  return el;
}
