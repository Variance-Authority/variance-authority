import { observeDocumentEvents, observeReactCommits } from './observe.js';
import { snapshotNode } from './snapshot.js';
import type { AttentionDraft, TargetSnapshot } from './access.js';

export const EYES_AGENT = '__variance_authority_eyes__';
export const EYES_AGENT_VERSION = 'eyes@1';
export const EYES_RECORD = '__variance_authority_eyes_record__';

export interface InstalledEyesAgent {
  readonly version: typeof EYES_AGENT_VERSION;
  readonly snapshot: (node: Node) => TargetSnapshot;
  readonly installDocument: (force?: boolean) => void;
}

type EyesPageGlobal = typeof globalThis & {
  [EYES_AGENT]?: InstalledEyesAgent;
  [EYES_RECORD]?: (attention: AttentionDraft) => Promise<void>;
};

/** Install the page-realm half before application code receives an event. */
export function installEyesAgent(): InstalledEyesAgent {
  const page = globalThis as EyesPageGlobal;
  const existing = page[EYES_AGENT];
  if (existing !== undefined) {
    existing.installDocument();
    return existing;
  }

  const record = page[EYES_RECORD];
  if (typeof record !== 'function') {
    throw new Error(`eyes page agent has no exposed ${EYES_RECORD} receiver`);
  }

  // The observation is already a complete value when this is called; the Promise
  // only carries it out of the realm. Losing the receiver must not turn a passing
  // application interaction into an unhandled rejection inside that application.
  const report = (attention: AttentionDraft): void => {
    void record(attention).catch(() => undefined);
  };

  const commits = observeReactCommits(report, { createHook: true });
  if (commits.refusal !== undefined) {
    report({ kind: 'react-tap-refused', reason: commits.refusal });
  }

  const installedDocuments = new WeakSet<Document>();
  const installDocument = (force = false): void => {
    if (!force && installedDocuments.has(document)) return;
    installedDocuments.add(document);

    // The stop function is dropped. A navigation replaces the document and takes
    // its listeners with it, and the agent has no teardown of its own.
    observeDocumentEvents(document, report);
  };

  const agent: InstalledEyesAgent = {
    version: EYES_AGENT_VERSION,
    snapshot: snapshotNode,
    installDocument,
  };
  page[EYES_AGENT] = agent;
  installDocument();

  return agent;
}
