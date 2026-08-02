/**
 * `@variance-authority/report` — what a run leaves behind.
 *
 * The **record** tool kind, in a box of its own. A run produces values in memory
 * and then the process ends; this is the shape the answers take so they can be
 * read afterwards, from a different process, on a different machine, by whoever
 * or whatever is asking.
 *
 * It lives here rather than with any of its readers because it has several, and
 * a format owned by one of them bends towards that one. The CLI writes it, the
 * MCP tools read it, a PR comment renders it, and none of those is the format's
 * home. That was not a hypothetical: the shapes used to live in the MCP package,
 * so the CLI depended on an agent protocol to describe its own output.
 *
 * The default entrypoint is the format and needs nothing.
 * `@variance-authority/report/file` reads and writes it on a disk.
 */

export type {
  RunReport,
  ObservationRecord,
  RegionRecord,
  NotObserved,
  NotObservedKind,
} from './format.js';
