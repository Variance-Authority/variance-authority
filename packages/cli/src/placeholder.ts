/**
 * How each `variance ask` argument is spelled in a synopsis, by property.
 *
 * Keyed by property rather than by tool: two questions taking a `subject` take
 * the same kind of thing, and a reader who has seen `<id>` once should not have
 * to decide whether the second means something else. A property nobody listed
 * falls back to its type, so this being out of date costs a word and not a flag.
 * Its own module, importing nothing, because the argument reader reads it on
 * every command line and the question catalogue loads every tool.
 */
export const PLACEHOLDER: Readonly<Record<string, string>> = {
  subject: '<id>',
  subjects: '<id>[,...]',
  component: '<name>',
  rule: '<id>',
  shape: '<digest>',
  claims: '<path>',
  test: '<id>',
  state: '<state>',
  build: '<id>',
  file: '<path>',
  files: '<path>[,...]',
  name: '<name>',
  line: '<file>:<line>',
  package: '<name>',
  subpath: '<subpath>',
  query: '<words>',
  under: '<words>',
  above: '<words>',
  inside: '<words>',
  beside: '<words>',
  leftOf: '<words>',
  rightOf: '<words>',
  on: '<words>',
  from: '<path>',
  to: '<path>',
  imports: '<module#name>',
  declares: '<regex>',
  path: '<regex>',
  text: '<pattern>',
  exceptFrom: '<path>',
  exceptTo: '<path>',
  exceptImports: '<module#name>',
  exceptDeclares: '<regex>',
  exceptPath: '<regex>',
  limit: '<n>',
  questions: "'<question>'",
};
