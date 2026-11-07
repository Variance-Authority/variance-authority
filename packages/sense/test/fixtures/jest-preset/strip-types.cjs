// Stands in for `ts-jest`: without it, the annotations in `.ts` files do not parse.
module.exports = { process: (source) => ({ code: source.replace(/: number/g, '') }) };
