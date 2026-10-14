// A build-time compiler that reads syntax, the way a CSS-in-JS extractor does:
// `css()` takes an arrow whose body it can evaluate, a condition between two
// strings, and anything else cannot have its styles extracted. It renames the
// call in place, so every column stays where it was. Each runner's config
// below runs it after the project's TypeScript transform, or before it: it
// reads either text.
const CALL = /\bcss\(\(([^)]*)\)\s*=>\s*(.*?)\);/g;
const EVALUABLE = /^[\w.]+ \? ["']\w+["'] : ["']\w+["']$/;

function extract(code) {
  const calls = [...code.matchAll(CALL)];
  for (const [, , body] of calls) {
    if (!EVALUABLE.test(body)) throw new Error(`extractor: \`${body}\` is unable to have its styles extracted`);
  }
  return calls.length === 0 ? code : code.replaceAll('css((', 'cls((');
}

module.exports = { extract };
