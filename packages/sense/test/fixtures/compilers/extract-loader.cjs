// The extractor as an Rspack loader, in the project's own rule. Rspack runs it
// after Rstest's SWC loader, so it reads SWC's output and hands on its own map
// composed onto SWC's, back to the file.
const remapping = require('@jridgewell/remapping');
const { extract } = require('./extract.cjs');

module.exports = function extractLoader(code, map) {
  const extracted = extract(code, this.resourcePath);
  if (extracted === undefined) return this.callback(null, code, map);
  const handed = typeof map === 'string' ? JSON.parse(map) : map;
  const composed = handed ? remapping(extracted.map, (file) => (file === this.resourcePath ? handed : null)) : extracted.map;
  this.callback(null, extracted.code, composed);
};
