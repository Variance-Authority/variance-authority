const { TestEnvironment } = require('jest-environment-node');
module.exports = class Environment extends TestEnvironment {
  async setup() {
    await super.setup();
    const { setting } = await import('./src/environment-only.js');
    this.global.environmentValue = setting();
  }
};
