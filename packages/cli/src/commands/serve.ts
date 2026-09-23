import { serve as serveTools } from '@variance-authority/mcp';
import { REPORTS } from '@variance-authority/mcp/protocol';
import type { Served, Tool, Tree } from '@variance-authority/mcp/tools';
import type { RunReport } from '@variance-authority/report';
import { readRunReport } from '@variance-authority/report/file';
import { readWorkspaceForAnswer, workspaceGeneration } from '@variance-authority/help';
import { HELP, HELP_TOOLS, type Help } from '@variance-authority/help/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import type { Config } from '../config.js';

/**
 * `variance serve` — the MCP surface, which is wiring and nothing else.
 *
 * The emptiness of this file is the design. Everything an agent can ask lives in
 * `@variance-authority/mcp` and `@variance-authority/help`: the tools are pure
 * functions from something already read to text, the protocol is a pure function
 * from a request to a response, and the transport is stream plumbing with no
 * decisions in it. If any of that were duplicated here to make the command "do
 * more", the two copies would answer differently and the agent's answer would be
 * the one nobody tested.
 *
 * **There is no option to make the server observe anything.** Every capability
 * this command could plausibly grow — re-run on demand, render a subject, refresh
 * a baseline — is work that belongs to the run, on the machine the run is pinned
 * to. A server that could render would render *here*, wherever here is, and
 * quietly answer questions about a machine that is not the one under test.
 *
 * What it does do is reload: the report is re-read on each request, so an agent
 * that fixes something, re-runs, and asks again is answered from the new report
 * rather than from the one loaded at boot. A stale report is how an agent ends up
 * confidently reporting a regression it has already fixed.
 *
 * ## One `ask`, and one server behind it
 *
 * The six source questions are on this server too, from the same `HELP_TOOLS`
 * the CLI mounts on `variance ask`. A workspace that has this package needs
 * nothing from `@variance-authority/help`'s binary, over either transport, and
 * that is the point: two servers answering about one checkout is two connections
 * for the agent to hold and two readings to drift apart. The standalone binary
 * stays for the workspace that runs no visual suite and has no `variance`.
 *
 * Which half is read is decided by the question. A report is a file and is read
 * every request. A source question reads the last published workspace generation
 * while it is less than an hour old; `--just-answer` removes even that expiry.
 * Producing a generation remains separate work. Neither half pays for the other.
 */

/** A run's report, and the workspace reading — whichever of them a question needed. */
interface Bench {
  readonly report: RunReport;
  /** Absent until one of the six is asked; nothing else reads it. */
  readonly help?: Help;
}

const SOURCE_QUESTIONS: ReadonlySet<string> = new Set(HELP_TOOLS.map((tool) => tool.name));

/**
 * One tool, over the half of the bench it is about.
 *
 * `previous` is projected with the subject, so the tool that compares two
 * requests still compares two reports rather than two benches; it was written
 * against a report and nothing here changes what it reads.
 */
function over<Inner>(
  tools: readonly Tool<Inner>[],
  half: (bench: Bench) => Inner | undefined,
  absent: string,
): readonly Tool<Bench>[] {
  return tools.map((tool) => ({
    ...tool,
    run: (bench: Bench, input: Readonly<Record<string, unknown>>, invocation?): string => {
      const inner = half(bench);
      if (inner === undefined) throw new Error(absent);
      const previous = invocation?.previous === undefined ? undefined : half(invocation.previous);
      return tool.run(inner, input, {
        ...(previous === undefined ? {} : { previous }),
        ...(invocation?.tree === undefined ? {} : { tree: invocation.tree }),
      });
    },
  }));
}

const BENCH: Served<Bench> = {
  name: REPORTS.name,
  version: REPORTS.version,
  tools: [
    ...over(REPORTS.tools, (bench) => bench.report, 'no run report was read'),
    ...over(
      HELP.tools,
      (bench) => bench.help,
      'the workspace could not be read, so the source questions cannot be answered',
    ),
  ],
  instructions: (bench) =>
    `${REPORTS.instructions?.(bench.report) ?? ''} ` +
    'The same connection answers six questions about the source — what this repository ' +
    'publishes, where a name is declared, and who imports it — read from the checkout, ' +
    'with no run required.',
};

export interface ServeOptions {
  /** The report to answer from. Defaults to the config's. */
  readonly report?: string;
  /** The checkout the source questions read, and the tree a start point resolves against. */
  readonly root?: string;
  /** Use the last published workspace generation and never refresh it. */
  readonly justAnswer?: boolean;
}

/** Returns the stop function. The caller owns the process lifetime, not this. */
export async function serve(config: Config, options: ServeOptions = {}): Promise<() => void> {
  const path = options.report ?? config.report;
  const root = options.root ?? process.cwd();
  const index = sourceIndexPath(root);

  // Read once before serving, so a path that is not a run report fails at
  // startup rather than on whichever request happens to arrive first. The
  // workspace is not read here: a connection that only ever asks about the run
  // should not pay for a scan it never uses.
  let report = await readRunReport(path);
  let help: Help | undefined;
  let tree: Tree | undefined;

  return serveTools<Bench>({
    input: process.stdin,
    output: process.stdout,
    served: BENCH,
    tree: () => tree,
    // Only the report. `previous` serves the one tool that compares this request
    // with the last one, and it compares reports; cloning a whole workspace
    // reading on every successful call would buy that comparison nothing.
    remember: (bench) => ({ report: structuredClone(bench.report) }),
    subject: async (asked) => {
      try {
        report = await readRunReport(path);
      } catch {
        // A report that becomes unreadable mid-run — being rewritten, most
        // likely — must not take the server down. The previous one is stale,
        // not wrong.
      }
      if (asked !== undefined && SOURCE_QUESTIONS.has(asked)) {
        try {
          const at = help === undefined ? undefined : workspaceGeneration(help);
          const stale = at === undefined || Date.now() - Date.parse(at) > 60 * 60 * 1000;
          if (help === undefined || (options.justAnswer !== true && stale)) {
            let nextTree: Tree | undefined;
            help = await readWorkspaceForAnswer(root, {
              index,
              justAnswer: options.justAnswer === true,
              tree: (drawn) => {
                nextTree = drawn;
              },
            });
            tree = nextTree;
          }
        } catch (failure) {
          // A workspace mid-edit — a manifest saved half-written, a file being
          // rewritten — must not take the server down. The previous reading is
          // stale, not wrong; the first one failing leaves nothing to answer
          // with, and the tool says so rather than this throwing at the
          // transport.
          if (help === undefined) process.stderr.write(`variance: ${failure instanceof Error ? failure.message : String(failure)}\n`);
        }
      }
      return { report, ...(help === undefined ? {} : { help }) };
    },
  });
}
