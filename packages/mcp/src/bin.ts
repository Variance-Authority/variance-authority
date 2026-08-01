#!/usr/bin/env node
import { serveReportFile } from './server.js';

/**
 * `variance-authority-mcp <report.json>`
 *
 * One argument, no flags, no config file. The server's whole job is to answer
 * questions about a report that already exists; anything it could be configured
 * to *do* would be work the run should have done, on the machine the run was on.
 */
const [, , path] = process.argv;

if (path === undefined) {
  process.stderr.write('usage: variance-authority-mcp <run-report.json>\n');
  process.exit(2);
}

await serveReportFile(path);
