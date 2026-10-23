// A transformer whose methods read `this`, as ts-jest's do.
class Transformer {
  constructor(options) {
    this.options = options;
  }
  getCacheKey(source) {
    return `key:${source}`;
  }
  process(source, path, options) {
    return { code: `${source}/*${JSON.stringify(this.options)} ${JSON.stringify(options.transformerConfig)}*/` };
  }
}

module.exports = { createTransformer: (options) => new Transformer(options) };
