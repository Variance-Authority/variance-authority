#!/usr/bin/env node
import { serveReportFile, serveVantage } from './server.js';

/**
 * `variance-authority-mcp <report.json>` — answer about a run that finished.
 * `variance-authority-mcp --watch` — answer about one that has not.
 *
 * One argument either way, no flags beyond it and no config file. The two modes
 * are two subjects, not two servers: a report is a file somebody produced, and a
 * watcher is a socket a run reports to for as long as this process is running.
 * Nothing it could be configured to *do* would be work the run should have done,
 * on the machine the run was on.
 *
 * The repository is the working directory this was started in, which is the one
 * coordinate a report cannot carry: a report is a file and it travels, and a
 * question that names a path is a question about a tree. Nothing to configure —
 * a client starting a server starts it somewhere, and somewhere is the answer.
 * Where that is not a checkout, a question with a start point in it is refused,
 * which is the same sentence as any other path that is not there.
 *
 * The address goes to stderr because stdout is the protocol. It is printed
 * rather than merely available, because a watcher nobody attached a run to is
 * indistinguishable from a broken one, and one line at startup is the cheapest
 * place to make attaching obvious.
 */
// TODO: `serveEyesArchive` is reachable from the library and from nothing on this
// command line, because the third subject does not fit "one positional argument".
// An eyes archive and a run report are both a path to a JSON file, so the argument
// alone cannot say which reader to use — deciding that needs either a flag, which
// this surface refuses on purpose, or sniffing the file's own version key, which
// makes the two formats' futures depend on each other.
const [, , path] = process.argv;

if (path === '--watch') {
  const { address } = await serveVantage();
  process.stderr.write(
    `variance-authority is watching. Start the suite with:\n` +
      `  VARIANCE_AUTHORITY_VANTAGE=${address}\n`,
  );
} else if (path === undefined) {
  process.stderr.write(
    'usage: variance-authority-mcp <run-report.json>\n' +
      '       variance-authority-mcp --watch\n',
  );
  process.exit(2);
} else {
  await serveReportFile(path, { root: process.cwd() });
}
