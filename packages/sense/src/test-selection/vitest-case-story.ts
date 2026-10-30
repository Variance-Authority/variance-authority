/**
 * The Vitest hooks that leave each case's tape on its own task's `meta`, for a
 * test file that runs in a page and tapes.
 *
 * The page knows the case, and the reporter knows how it ended, so the tape
 * travels beside the names the record knows the case by. What runs between two
 * cases is taken and dropped, so a case's story opens at its first hook.
 *
 * The hooks name no parameter for the reason the setup's `afterAll` does; the
 * context's `task` is the case. Its name is the declaration path under the
 * file, as the case runner keys a case in Node.
 */
export function caseStorySource(journal: string): string {
  return `
beforeEach(() => { execution.story?.(); });
afterEach(function () {
  const task = arguments[0]?.task;
  const story = execution.story?.();
  if (task === undefined || story === undefined) return;
  const names = [];
  for (let at = task; at !== undefined && at !== task.file; at = at.suite) names.unshift(at.name);
  (task.meta ??= {})[${JSON.stringify(journal)}] = {
    story,
    file: task.file?.filepath ?? '',
    name: task.fullTestName ?? names.join(' > '),
    id: task.id,
    project: task.file?.projectName,
  };
});`;
}
