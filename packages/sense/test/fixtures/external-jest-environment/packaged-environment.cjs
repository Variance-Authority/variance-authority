const { TestEnvironment } = require('jest-environment-node');
// An installed package requires the repository file, as a configuration loader does.
const setting = require('load-setting')(require.resolve('./src/packaged-setting.cjs'));

module.exports = class PackagedEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.environmentValue = setting;
  }
};
