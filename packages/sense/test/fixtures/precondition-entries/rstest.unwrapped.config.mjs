import { fileURLToPath } from 'node:url';

// Nobody wrapped this project, and `rstest.path.config.mjs` names it by this path.
export default { name: 'unwrapped', root: fileURLToPath(new URL('.', import.meta.url)), globals: true, include: ['test/entries.check.ts'] };
