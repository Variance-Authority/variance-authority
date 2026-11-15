// The fixture's transformer, which says in which process it transformed which
// file: SWC's, run once per file Jest's cache did not already hold.
const { appendFileSync } = require('node:fs');
const swc = require('@swc/jest').createTransformer({ jsc: { parser: { syntax: 'typescript' } } });

module.exports = {
  ...swc,
  process(source, path, options) {
    appendFileSync(process.env.FIXTURE_TRANSFORM_LOG, `${process.pid} ${path}\n`);
    return swc.process(source, path, options);
  },
};
