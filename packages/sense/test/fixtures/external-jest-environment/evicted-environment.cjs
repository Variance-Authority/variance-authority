const { TestEnvironment } = require('jest-environment-node');
// The child stays on this module with nothing left to name it.
require('./src/imported-settings.json');
delete require.cache[require.resolve('./src/imported-settings.json')];

module.exports = class EvictedEnvironment extends TestEnvironment {};
