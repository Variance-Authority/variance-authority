#!/usr/bin/env node

import { finalizeJestJourneys, stitchJourneyArtifacts } from './jest-journey-artifact.js';

const [, , command, ...args] = process.argv;

try {
  if (command === 'finalize' && args.length === 1) {
    const result = await finalizeJestJourneys(args[0]!);
    process.stdout.write(`journeys: wrote ${args[0]} (${result.tests} tests, ${result.modules} modules, ${result.crossings} crossings)\n`);
  } else if (command === 'stitch' && args.length >= 3 && args.at(-2) === '--into') {
    const output = args.at(-1)!;
    const result = await stitchJourneyArtifacts(args.slice(0, -2), output);
    process.stdout.write(`journeys: stitched ${result.shards} shards into ${output} (${result.tests} tests, ${result.modules} modules, ${result.crossings} crossings)\n`);
  } else {
    process.stderr.write(
      'usage:\n' +
      '  sense-journeys finalize <journey-file>\n' +
      '  sense-journeys stitch <shard-file>... --into <journey-file>\n',
    );
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
