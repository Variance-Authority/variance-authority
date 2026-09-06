import {
  createCallSiteResolver,
  relativizeSource,
  type FetchModule,
  type SourceIndex,
  type SourceRef,
  type StackFrame,
} from '@variance-authority/core';
import type { CDPSession, Page } from 'playwright';
import { AGENT_GLOBAL } from './agent.js';
import { fetchModules } from './modules.js';

/**
 * Where a component is declared, asked of the engine that ran it.
 *
 * The source scan answers a *name*: every declaration in the configured
 * directories that spells `Button`, and when two do, the name is ambiguous and
 * the report says so. The page holds something better than a name. The fiber
 * carries the function React called, and V8 knows where every function it
 * compiled begins. So the page agent keeps the functions it met (`declared` on
 * the installed global, see `@variance-authority/react`'s `declared.ts`), and
 * this asks Chromium, over CDP, for each one's `[[FunctionLocation]]`. The
 * position is in the served module; the same source maps the call-site path
 * already fetches turn it into a repository file and line.
 *
 * What comes back is a `SourceIndex` with `via: 'engine'`, meant to be laid over
 * the scan with `overlaySourceIndex`: a name the engine located replaces the
 * scan's candidates for it, and a name the engine never met keeps them. The
 * engine can only speak for a component that rendered, which is the half of the
 * question the scan cannot answer and precisely the half a reader of this run
 * needs.
 *
 * Chromium only. `[[FunctionLocation]]` is a V8 internal property and CDP is the
 * road to it; on WebKit and Firefox `newCDPSession` throws, the reader notes it
 * once, and `read()` answers an empty index for the rest of the page's life.
 * Nothing downstream distinguishes that from a page with no components, and
 * nothing should: both are "the engine said nothing", and the scan still stands.
 *
 * A read is incremental. The registry in the page only grows, so each read asks
 * about the functions registered since the last one and returns the union of
 * everything located so far. The registry's `id` changes when the bundle is
 * installed again — a navigation in the route collector — and a changed id
 * starts the count over.
 */
export interface DeclarationReader {
  /** Everything located so far, after asking about what is new. Never throws. */
  read(): Promise<SourceIndex>;
  readonly stats: DeclarationStats;
  /** Detaches the CDP session, if one was ever opened. */
  close(): Promise<void>;
}

export interface DeclarationStats {
  /** Functions the engine was asked about. */
  readonly asked: number;
  /** Of those, the ones that mapped to a file the project wrote. */
  readonly located: number;
}

export interface DeclarationReaderOptions {
  /** The global the page agent is installed at. `AGENT_GLOBAL` unless told otherwise. */
  readonly global?: string;
  /** How served modules are fetched for their maps. From inside the page unless told otherwise. */
  readonly fetchModule?: FetchModule;
  /** Repository root, so the answer is the path the source index speaks. `process.cwd()` unless told otherwise. */
  readonly root?: string;
}

/** What `[[FunctionLocation]]` holds. Zero-based, as the protocol counts. */
interface FunctionLocation {
  readonly scriptId: string;
  readonly lineNumber: number;
  readonly columnNumber?: number;
}

interface Registered {
  readonly id: string;
  readonly names: readonly string[];
}

/**
 * A reader over one page's registry. Opens its CDP session on the first read
 * that has something to ask and keeps it until `close`; every read before and
 * after that answers from what it holds. `global` names where the agent is
 * installed, `fetchModule` how served modules are fetched for their maps, and
 * `root` the path an answer is made relative to.
 */
export function createDeclarationReader(
  page: Page,
  options: DeclarationReaderOptions = {},
): DeclarationReader {
  const global = options.global ?? AGENT_GLOBAL;
  const root = options.root ?? process.cwd();
  const resolver = createCallSiteResolver(options.fetchModule ?? fetchModules(page));
  const stats = { asked: 0, located: 0 };

  /** Name → what the engine said. Refs deduped by file and line. */
  const index = new Map<string, SourceRef[]>();
  /** `scriptId` → the URL it was served at, from `Debugger.scriptParsed`. */
  const scripts = new Map<string, string>();
  /** `undefined` until the first ask; `null` once the engine has declined. */
  let session: CDPSession | null | undefined;
  let generation: string | null = null;
  let seen = 0;

  async function sessionFor(): Promise<CDPSession | null> {
    if (session !== undefined) return session;
    try {
      const opened = await page.context().newCDPSession(page);
      opened.on('Debugger.scriptParsed', (event) => {
        scripts.set(event.scriptId, event.url);
      });
      session = opened;
    } catch {
      session = null;
    }
    return session;
  }

  function snapshot(): SourceIndex {
    const out: Record<string, readonly SourceRef[]> = {};
    for (const [name, refs] of index) out[name] = [...refs];
    return out;
  }

  function add(name: string, ref: SourceRef): void {
    const held = index.get(name) ?? [];
    if (held.some((it) => it.file === ref.file && it.line === ref.line)) return;
    index.set(name, [...held, ref]);
  }

  async function locateNew(cdp: CDPSession, names: readonly string[]): Promise<void> {
    // Enabled per read, not per page: the domain replays every parsed script on
    // enable, which is how `scripts` is filled, and a debugger left on is a
    // debugger the page's own code runs under.
    await cdp.send('Debugger.enable');
    const objectGroup = `variance-declared-${seen}`;
    try {
      const array = await cdp.send('Runtime.evaluate', {
        expression: `globalThis[${JSON.stringify(global)}].declared.functions`,
        objectGroup,
      });
      const arrayId = array.result.objectId;
      if (arrayId === undefined) return;

      const { result: elements } = await cdp.send('Runtime.getProperties', {
        objectId: arrayId,
        ownProperties: true,
      });
      const functions = new Map<number, string>();
      for (const element of elements) {
        const at = Number(element.name);
        if (Number.isInteger(at) && element.value?.objectId !== undefined) {
          functions.set(at, element.value.objectId);
        }
      }

      for (let at = seen; at < names.length; at += 1) {
        const objectId = functions.get(at);
        const name = names[at];
        if (objectId === undefined || name === undefined) continue;
        stats.asked += 1;

        const { internalProperties } = await cdp.send('Runtime.getProperties', {
          objectId,
          ownProperties: true,
        });
        const location = internalProperties?.find((it) => it.name === '[[FunctionLocation]]')
          ?.value?.value as FunctionLocation | undefined;
        const url = location === undefined ? undefined : scripts.get(location.scriptId);
        if (location === undefined || url === undefined || url === '') continue;

        // The resolver speaks stack frames, one-based. A function's location is
        // the same kind of coordinate as a call site's — a position in a served
        // module — so it goes through the same maps and the same vendor rule.
        const frame: StackFrame = {
          url,
          line: location.lineNumber + 1,
          column: (location.columnNumber ?? 0) + 1,
        };
        const answer = await resolver.locate([frame]);
        if (answer === null) continue;

        const at_ = relativizeSource(answer, root);
        stats.located += 1;
        add(name, { file: at_.file, line: at_.line, via: 'engine' });
      }
      seen = names.length;
      await cdp.send('Runtime.releaseObjectGroup', { objectGroup });
    } finally {
      await cdp.send('Debugger.disable').catch(() => undefined);
    }
  }

  return {
    async read(): Promise<SourceIndex> {
      try {
        const registered = await page.evaluate((name: string): Registered | null => {
          const agent = (globalThis as Record<string, unknown>)[name] as
            | { declared?: { id: string; names: readonly string[] } }
            | undefined;
          const declared = agent?.declared;
          return declared === undefined ? null : { id: declared.id, names: [...declared.names] };
        }, global);
        if (registered === null) return snapshot();

        if (registered.id !== generation) {
          generation = registered.id;
          seen = 0;
        }
        if (registered.names.length <= seen) return snapshot();

        const cdp = await sessionFor();
        if (cdp !== null) await locateNew(cdp, registered.names);
      } catch {
        // The page navigated, the session went with the target, a module could
        // not be had: what was located before this read stands, and the rest is
        // asked again next time.
      }
      return snapshot();
    },
    stats: stats as DeclarationStats,
    async close(): Promise<void> {
      const open = session;
      session = null;
      if (open) await open.detach().catch(() => undefined);
    },
  };
}
