import { tapCommits } from '@variance-authority/react';
import { snapshotNode } from './snapshot.js';
import type { AttentionDraft, TargetSnapshot } from './access.js';

export const EYES_AGENT = '__variance_authority_eyes__';
export const EYES_AGENT_VERSION = 'eyes@1';
export const EYES_RECORD = '__variance_authority_eyes_record__';

const EVENTS = [
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'keydown',
  'keyup',
  'input',
  'change',
  'submit',
  'focusin',
  'focusout',
  'dragstart',
  'drop',
] as const;

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

  const installedDocuments = new WeakSet<Document>();
  tapCommits({
    onCommit: (commit) => {
      // Losing an observer must not turn a passing application interaction into
      // an unhandled rejection inside that application.
      void record({ kind: 'react-commit', commit }).catch(() => undefined);
    },
  });
  const installDocument = (force = false): void => {
    if (!force && installedDocuments.has(document)) return;
    installedDocuments.add(document);

    for (const type of EVENTS) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;

          // The snapshot is complete before the Promise crosses realms. In
          // particular, React has not received this capture-phase event yet and
          // therefore has not had an opportunity to unmount the target.
          void record({
            kind: 'document-event',
            event: event.type,
            trusted: event.isTrusted,
            target: snapshotNode(target),
          });
        },
        { capture: true },
      );
    }
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
