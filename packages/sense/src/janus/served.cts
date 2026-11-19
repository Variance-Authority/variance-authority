// compass: variance-authority.reach
/**
 * What a `variance janus` run serves, shared by its two preloads: the manifest
 * `VARIANCE_JANUS_MANIFEST` names, and the note of each served file this
 * process read.
 *
 * The manifest is `{ "<absolute path>": "<content>" | null }`: a string is the
 * content the path holds for this run, whether or not the disk holds the file,
 * and `null` is a file the disk holds that this run does not see.
 *
 * A read is noted under `VARIANCE_JANUS_READS`, one file per process and
 * thread, appended at the first read of each path rather than at exit: a test
 * process is often ended by its runner, and a note written at exit would not be.
 * The command reads the notes back to prove the run read what it was served.
 *
 * CommonJS, so `serve-fs.cts`, preloaded with `--require`, and
 * `serve-modules.mts`, preloaded with `--import`, share this one instance.
 */

import fs = require('node:fs');
import path = require('node:path');
import workers = require('node:worker_threads');

const manifest = process.env.VARIANCE_JANUS_MANIFEST;
const notes = process.env.VARIANCE_JANUS_READS;

/** Each path this run serves or hides, keyed by its absolute path. */
const files: Readonly<Record<string, string | null>> = manifest === undefined ? {} : (JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<string, string | null>);

const noted = new Set<string>();

/** Note that this process read the served content of `file`. */
function read(file: string): void {
  if (notes === undefined || noted.has(file)) return;
  noted.add(file);
  fs.appendFileSync(path.join(notes, `${process.pid}-${workers.threadId}`), `${file}\n`);
}

export = { files, read };
