// The project's Jest transformer: the extractor on the file as Jest read it, as
// a Babel plugin reads it, then SWC on what the extractor wrote, reading the
// extractor's map from the text so its own map runs back to the file.
const { createTransformer } = require('@swc/jest');
const { extract } = require('./extract.cjs');

const swc = createTransformer({ jsc: { parser: { syntax: 'typescript' } }, sourceMaps: true, inputSourceMap: true });

function inlined({ code, map }) {
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`;
}

module.exports = {
  getCacheKey: (source, path, options) => `extract:${swc.getCacheKey(source, path, options)}`,
  process: (source, path, options) => {
    const extracted = extract(source, path);
    return swc.process(extracted === undefined ? source : inlined(extracted), path, options);
  },
};
