import { stringify } from 'yaml';
import { runExperiment } from './invocation.mjs';

const { summary, exitCode } = await runExperiment(process.argv.slice(2));
console.log(stringify(summary));
process.exitCode = exitCode;
