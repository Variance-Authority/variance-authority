// A resolver that alone knows where `project-runtime` lives.
const { resolve } = require('node:path');
module.exports = (request, options) =>
  request === 'project-runtime' ? resolve(__dirname, 'runtime.cjs') : options.defaultResolver(request, options);
