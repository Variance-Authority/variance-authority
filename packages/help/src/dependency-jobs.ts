/**
 * Twenty-four jobs an agent might describe, each with the package that should
 * answer it, over packages as they publish themselves: a description, keywords,
 * README headings and a few exported names. The fixture is the corpus the
 * measurement runs against, so a change to how a described job is ranked moves
 * a number instead of a feeling.
 */

// compass: variance-authority.report.agent-surface

export interface FixturePackage {
  readonly name: string;
  readonly description: string;
  readonly keywords?: readonly string[];
  readonly headings?: readonly string[];
  /** `name: first sentence of its documentation`. */
  readonly names?: Readonly<Record<string, string>>;
}

export const PACKAGES: readonly FixturePackage[] = [
  { name: 'react', description: 'React is a JavaScript library for building user interfaces.', keywords: ['react'],
    names: { useState: 'Returns a stateful value, and a function to update it.', useEffect: 'Accepts a function that contains imperative code.', useReducer: 'An alternative to useState for state logic.' } },
  { name: 'redux', description: 'Predictable state container for JavaScript apps', keywords: ['redux', 'state', 'predictable', 'functional', 'flux'], headings: ['Installation', 'Basic Example'] },
  { name: 'zod', description: 'TypeScript-first schema validation with static type inference', keywords: ['typescript', 'schema', 'validation', 'type', 'inference'] },
  { name: 'express', description: 'Fast, unopinionated, minimalist web framework', keywords: ['express', 'framework', 'sinatra', 'web', 'http', 'rest', 'restful', 'router', 'app', 'api'] },
  { name: 'axios', description: 'Promise based HTTP client for the browser and node.js', keywords: ['xhr', 'http', 'ajax', 'promise', 'node'] },
  { name: 'lodash', description: 'Lodash modular utilities.', keywords: ['modules', 'stdlib', 'util'], names: { debounce: 'Creates a debounced function that delays invoking func.', cloneDeep: 'Recursively clones a value.' } },
  { name: 'date-fns', description: 'Modern JavaScript date utility library', keywords: ['date', 'time', 'format', 'parse', 'timezone'], names: { formatDistance: 'Return the distance between the given dates in words.' } },
  { name: 'winston', description: 'A logger for just about everything.', keywords: ['winston', 'logger', 'logging', 'log', 'transport'] },
  { name: 'commander', description: 'the complete solution for node.js command-line interfaces', keywords: ['commander', 'command', 'option', 'parser', 'cli', 'argument'] },
  { name: 'chalk', description: 'Terminal string styling done right', keywords: ['color', 'colour', 'colors', 'terminal', 'console', 'cli', 'string', 'ansi', 'style'] },
  { name: 'jest', description: 'Delightful JavaScript Testing', keywords: ['test', 'testing', 'jest', 'assertions', 'mock'] },
  { name: 'uuid', description: 'RFC9562 UUIDs', keywords: ['uuid', 'guid', 'rfc4122', 'unique', 'identifier'] },
  { name: 'yaml', description: 'JavaScript parser and stringifier for YAML', keywords: ['yaml', 'parser', 'stringifier'] },
  { name: 'ws', description: 'Simple to use, blazing fast and thoroughly tested websocket client and server for Node.js', keywords: ['HyBi', 'Push', 'RFC-6455', 'WebSocket', 'WebSockets'] },
  { name: 'sharp', description: 'High performance Node.js image processing, the fastest module to resize JPEG, PNG, WebP, AVIF and TIFF images', keywords: ['jpeg', 'png', 'webp', 'avif', 'image', 'resize', 'thumbnail'] },
  { name: 'bcrypt', description: 'A bcrypt library for NodeJS', keywords: ['bcrypt', 'password', 'auth', 'authentication', 'encryption', 'crypt', 'crypto'] },
  { name: 'jsonwebtoken', description: 'JSON Web Token implementation (symmetric and asymmetric)', keywords: ['jwt', 'token', 'sign', 'verify', 'auth'] },
  { name: 'nodemailer', description: 'Easy as cake e-mail sending from your Node.js applications', keywords: ['nodemailer', 'email', 'mail', 'smtp'] },
  { name: 'glob', description: 'the most correct and second fastest glob implementation in JavaScript', keywords: ['glob', 'file', 'pattern', 'match'] },
  { name: 'semver', description: 'The semantic version parser used by npm.', keywords: ['semver', 'version', 'range', 'compare'] },
  { name: 'debug', description: 'Lightweight debugging utility for Node.js and the browser', keywords: ['debug', 'log', 'debugger'] },
  { name: 'rxjs', description: 'Reactive Extensions for modern JavaScript', keywords: ['Rx', 'RxJS', 'ReactiveX', 'Observable', 'Observables', 'stream', 'streams', 'reactive'] },
  { name: 'ajv', description: 'Another JSON Schema Validator', keywords: ['JSON', 'schema', 'validator', 'validation'] },
  { name: 'marked', description: 'A markdown parser built for speed', keywords: ['markdown', 'markup', 'html'], headings: ['Usage', 'Supported Markdown specifications'] },
  { name: 'prettier', description: 'Prettier is an opinionated code formatter', keywords: ['format', 'formatter', 'code', 'style'] },
  { name: 'pg', description: 'PostgreSQL client - pure javascript & libpq with the same API', keywords: ['database', 'libpq', 'pg', 'postgre', 'postgres', 'postgresql', 'rdbms'] },
];

/** What each described job should reach. */
export const JOBS: readonly { readonly job: string; readonly expects: string }[] = [
  { job: 'state management', expects: 'redux' },
  { job: 'validate a schema', expects: 'zod' },
  { job: 'make http requests', expects: 'axios' },
  { job: 'web server framework', expects: 'express' },
  { job: 'format dates', expects: 'date-fns' },
  { job: 'write logs to a transport', expects: 'winston' },
  { job: 'parse command line arguments', expects: 'commander' },
  { job: 'colour terminal output', expects: 'chalk' },
  { job: 'unit testing', expects: 'jest' },
  { job: 'generate unique identifiers', expects: 'uuid' },
  { job: 'parse yaml', expects: 'yaml' },
  { job: 'websocket server', expects: 'ws' },
  { job: 'resize images', expects: 'sharp' },
  { job: 'hash passwords', expects: 'bcrypt' },
  { job: 'sign a json web token', expects: 'jsonwebtoken' },
  { job: 'send email', expects: 'nodemailer' },
  { job: 'match files by glob pattern', expects: 'glob' },
  { job: 'compare semantic versions', expects: 'semver' },
  { job: 'observable streams', expects: 'rxjs' },
  { job: 'validate json against a schema', expects: 'ajv' },
  { job: 'render markdown to html', expects: 'marked' },
  { job: 'format source code', expects: 'prettier' },
  { job: 'query a postgres database', expects: 'pg' },
  { job: 'keep a stateful value in a component', expects: 'react' },
];
