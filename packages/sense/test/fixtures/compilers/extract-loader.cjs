// The extractor as an Rspack loader, in the project's own rule. Rspack runs it
// after SWC, Rstest's or the build's own, so it reads SWC's output and hands on
// its own map composed onto SWC's, back to the file.
const remapping = require('@jridgewell/remapping');
const { extract } = require('./extract.cjs');

module.exports = function extractLoader(code, map) {
  const extracted = extract(code, this.resourcePath);
  if (extracted === undefined) return this.callback(null, code, map);
  const handed = typeof map === 'string' ? JSON.parse(map) : map;
  // Once: a handed map that names the file by the same absolute path, as
  // Rspack's built-in SWC loader writes one, would otherwise lead to itself.
  let composing = false;
  const composed = handed
    ? remapping(extracted.map, (file) => {
        if (composing || file !== this.resourcePath) return null;
        composing = true;
        return handed;
      })
    : extracted.map;
  this.callback(null, extracted.code, composed);
};
