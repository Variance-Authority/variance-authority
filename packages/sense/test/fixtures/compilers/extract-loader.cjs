// The extractor as an Rspack loader, in the project's own rule.
const { extract } = require('./extract.cjs');

module.exports = function extractLoader(code, map) {
  this.callback(null, extract(code), map);
};
