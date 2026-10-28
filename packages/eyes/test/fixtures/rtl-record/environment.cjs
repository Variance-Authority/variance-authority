// A document for each test file, as `jest-environment-jsdom` gives one: the
// window's own globals laid over Node's, which this repository does not install.
const { TestEnvironment } = require('jest-environment-node');
const { JSDOM } = require('jsdom');

module.exports = class DocumentEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    this.dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const window = this.dom.window;
    for (const key of Object.getOwnPropertyNames(window)) {
      if (key in this.global) continue;
      Object.defineProperty(this.global, key, { configurable: true, get: () => window[key] });
    }
  }

  async teardown() {
    this.dom.window.close();
    await super.teardown();
  }
};
