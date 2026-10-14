// A build-time compiler that reads syntax, the way a CSS-in-JS extractor does:
// `css()` takes an arrow whose body it can evaluate, a condition between two
// strings, and anything else cannot have its styles extracted. It replaces the
// call with one to `cls` that names the class it extracted, so every column
// after the call moves, and it returns the map of what it wrote. Each runner's
// config below runs it after the project's TypeScript transform, or before
// it: it reads either text.
const MagicString = require('magic-string');

const CALL = /\bcss\(\(([^)]*)\)\s*=>\s*(.*?)\);/g;
const EVALUABLE = /^[\w.]+ \? ["']\w+["'] : ["']\w+["']$/;

/** The extracted text and its map, or `undefined` where `code` calls no `css()`. */
function extract(code, file) {
  const calls = [...code.matchAll(CALL)];
  if (calls.length === 0) return undefined;
  const written = new MagicString(code);
  for (const call of calls) {
    if (!EVALUABLE.test(call[2])) throw new Error(`extractor: \`${call[2]}\` is unable to have its styles extracted`);
    written.overwrite(call.index, call.index + 'css('.length, `cls('tone-${call.index.toString(36)}', `);
  }
  return { code: written.toString(), map: written.generateMap({ hires: true, source: file, includeContent: true }) };
}

module.exports = { extract };
