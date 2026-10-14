// The project's Jest transformer: the extractor on the file as Jest read it, as
// a Babel plugin reads it, then SWC on what the extractor wrote.
const { createTransformer } = require('@swc/jest');
const { extract } = require('./extract.cjs');

const swc = createTransformer({ jsc: { parser: { syntax: 'typescript' } }, sourceMaps: true });

module.exports = {
  getCacheKey: (source, path, options) => `extract:${swc.getCacheKey(source, path, options)}`,
  process: (source, path, options) => swc.process(extract(source), path, options),
};
