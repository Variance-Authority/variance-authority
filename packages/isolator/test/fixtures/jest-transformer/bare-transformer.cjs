// A transformer with no key and only an asynchronous transform.
module.exports = Promise.resolve({ processAsync: async (source) => ({ code: source.toUpperCase() }) });
