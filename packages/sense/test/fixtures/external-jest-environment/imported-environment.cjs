const { TestEnvironment } = require('jest-environment-node');
// The configuration imported this file, so Node answers with the entry `import` left.
const settings = require('./src/imported-settings.json');

module.exports = class ImportedEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.environmentValue = settings.value;
  }
};
