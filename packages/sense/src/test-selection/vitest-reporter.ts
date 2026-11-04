/**
 * The reporter a Vitest run folds through: the end of the run, as whichever
 * major announces it, narrowed to which files finished and how.
 */

import type { Reporter } from 'vitest/node';
import {
  carriedJournal,
  reportedComplete,
  runnerSkipped,
  taskComplete,
  type FinishedFile,
  type ReportedModule,
  type RunnerTask,
} from './finished-files.js';
import { reportedDuration, reportedPhases } from './reported-time.js';
import { namedTasks, reportedCases, taskCases } from './case-durations.js';
import { noteRunner, projectConfig, type RunnerContext } from './governing-config.js';
import { reopenRun, type SelectionRun } from './selection-run.js';
import { writeCarriedStories } from './carried-stories.js';

export function selectionReporter(
  run: SelectionRun,
  settle: (files: readonly FinishedFile[]) => Promise<void>,
  story?: string,
): Reporter {
  // Vitest 2 announces the end of a run as `onFinished(files)`, where a file is
  // a runner task. Vitest 3 replaced that with `onTestRunEnd(testModules)` over
  // a reported-task API, and Vitest 4 stopped calling `onFinished` on reporters
  // altogether — silently, because a reporter with no hook a runner recognises
  // is a reporter that never objects. A suite would go green and write no
  // snapshot. Both hooks are declared, both narrow to the same two facts, and
  // whichever the runner calls first is the one that counts.
  //
  // Each file also carries the configuration it ran under, as the runner
  // resolved it: Vitest 3 and 4 hand the project over, and Vitest 2 hands its
  // name, which `onInit` has already mapped to the project.
  let byName = new Map<string, string>();
  // Held, not copied: a name filter and a cancel are both set on the runner
  // after `onInit`, and each run's end asks it afresh.
  let runner: RunnerContext | undefined;
  const configsOf = (config: string | undefined) => (config === undefined ? {} : { configs: [config] });
  // A rerun starts as `onWatcherRerun` in every major and as `onTestRunStart`
  // from Vitest 3, both after the last run's end was awaited: the fold reopens
  // there, and the rerun's end folds the files the rerun ran.
  return {
    onInit: (context: RunnerContext) => {
      runner = context;
      byName = noteRunner(run, context);
      run.watching = context.config?.watch === true;
    },
    // Both fire before a worker reads a file of the cycle; the first cycle
    // keeps the start the run was made at, before the configuration loaded.
    onWatcherRerun: () => reopenRun(run, Date.now()),
    onTestRunStart: () => reopenRun(run, run.settled ? Date.now() : run.startedAt),
    onFinished: async (files: readonly RunnerTask[]) => {
      // The end is announced through both hooks; the first to arrive writes.
      if (!run.settled) await writeCarriedStories(story, files.flatMap((file) => namedTasks(file).map(({ task, name }) => ({
        file: file.filepath, name, id: task.id, project: file.projectName,
        meta: task.meta,
        stopped: task.result?.state === 'fail',
      }))));
      await settle(
      files.flatMap((file) => file.filepath === undefined
        ? []
        : [{
          filepath: file.filepath,
          complete: taskComplete(file, runnerSkipped(runner)),
          ...reportedDuration(file.result?.duration),
          ...reportedPhases({
            prepare: file.prepareDuration,
            environment: file.environmentLoad,
            setup: file.setupDuration,
            collect: file.collectDuration,
            cases: file.result?.duration,
          }),
          ...taskCases(file),
          ...carriedJournal(file.filepath, file.meta),
          ...configsOf(byName.get(file.projectName ?? '')),
        }]),
      );
    },
    onTestRunEnd: async (reported: readonly ReportedModule[], _errors?: unknown, reason?: string) => {
      if (!run.settled) await writeCarriedStories(story, reported.flatMap((module) => [...module.children.allTests()].map((test) => ({
        file: module.moduleId, name: test.fullName, id: test.id, project: module.project?.name,
        meta: test.meta?.(),
        stopped: test.result().state === 'failed',
      }))));
      await settle(
      reported.map((module) => ({
        filepath: module.moduleId,
        complete: reportedComplete(module, runnerSkipped(runner, reason)),
        ...reportedDuration(module.diagnostic?.()?.duration),
        ...modulePhases(module.diagnostic?.()),
        ...reportedCases(module),
        ...carriedJournal(module.moduleId, module.meta?.()),
        ...configsOf(projectConfig(module.project)),
      })),
      );
    },
  } as Reporter;
}

/** Vitest 3 and 4's phases for a module, under the record's names. */
function modulePhases(diagnostic: ReturnType<NonNullable<ReportedModule['diagnostic']>>): Pick<FinishedFile, 'phases'> {
  return diagnostic === undefined ? {} : reportedPhases({
    prepare: diagnostic.prepareDuration,
    environment: diagnostic.environmentSetupDuration,
    setup: diagnostic.setupDuration,
    collect: diagnostic.collectDuration,
    cases: diagnostic.duration,
  });
}
