// compass: variance-authority.report.agent-surface

/** The source index the addon read and checked once for one question; `close` lets its bytes go. */
export interface OpenedIndex {
  close(): void;
}

/** The indexes the running question opened, by path; `undefined` outside one. */
let question: Map<string, OpenedIndex> | undefined;

/**
 * `ask`, run as one synchronous question. Each index is opened once and closed
 * when `ask` returns or throws. A nested question belongs to the running one;
 * no index or identity survives into the next question.
 */
export function asOneQuestion<T>(ask: () => T): T {
  if (question !== undefined) return ask();
  const held = new Map<string, OpenedIndex>();
  question = held;
  try {
    return ask();
  } finally {
    question = undefined;
    for (const opened of held.values()) opened.close();
  }
}

/** The running synchronous question's opaque identity; absent outside a question. */
export function questionIdentity(): object | undefined {
  return question;
}

/** Read an index once in the running question, using its reader's opener. */
export function onQuestionIndex<T>(index: string, open: () => OpenedIndex, read: (opened: OpenedIndex) => T): T {
  return asOneQuestion(() => {
    const held = question!;
    let opened = held.get(index);
    if (opened === undefined) {
      opened = open();
      held.set(index, opened);
    }
    return read(opened);
  });
}
