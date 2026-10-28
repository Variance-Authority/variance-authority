#!/usr/bin/env node
import { runEditors } from './run.mjs';

const { code, out, err } = runEditors(process.argv.slice(2));
if (out !== '') process.stdout.write(out);
if (err !== '') process.stderr.write(err);
process.exit(code);
