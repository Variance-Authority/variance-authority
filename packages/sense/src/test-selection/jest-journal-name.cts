/**
 * The name of the file a Jest sandbox writes one test file's journal to, and
 * the project the reporter reads back from that name.
 *
 * A journal names its test file and nothing else, and two projects that run
 * one file write a journal each for the same path. A project that skips every
 * test of the file runs none of its hooks and writes none, so a reporter that
 * matched by path alone would take the other project's journal for it. The
 * project rides the file name, as hex so that any `displayName` is a name every
 * file system takes, and the stamp before it holds no dot.
 */
function journalName(stamp: string, project: string | undefined): string {
  return project === undefined ? `${stamp}.va` : `${stamp}.${Buffer.from(project, 'utf8').toString('hex')}.va`;
}

/** The project a journal's file name carries; absent for a project without a name. */
function projectOfJournal(name: string): string | undefined {
  const parts = name.split('.');
  return parts.length === 3 ? Buffer.from(parts[1] ?? '', 'hex').toString('utf8') : undefined;
}

export = { journalName, projectOfJournal };
