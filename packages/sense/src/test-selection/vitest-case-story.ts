import { carryingHooks } from './carried-stories.js';

/**
 * The Vitest hooks that leave each case's tape on its own task's `meta`, for a
 * test file that runs in a page and tapes.
 *
 * The page knows the case, and the reporter knows how it ended, so the tape
 * travels beside the names the record knows the case by. Its name is the
 * declaration path under the file, as the case runner keys a case in Node.
 */
export function caseStorySource(): string {
  return carryingHooks(`(() => {
    const names = [];
    for (let at = task; at !== undefined && at !== task.file; at = at.suite) names.unshift(at.name);
    return {
      file: task.file?.filepath ?? '',
      name: task.fullTestName ?? names.join(' > '),
      id: task.id,
      project: task.file?.projectName,
    };
  })()`);
}
