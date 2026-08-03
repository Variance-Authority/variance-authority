/**
 * The contract half — what a deployment is made of, with nothing that runs.
 *
 * The entrypoint an operator imports to declare their bindings and apply their
 * schema. Everything that touches a request is behind `./store`, `./history`,
 * `./review` and `./worker`, so a build script that only needs the SQL does not
 * pull in the router, and a Worker that only serves baselines does not pull in
 * React.
 */

export type {
  D1Like,
  D1PreparedLike,
  D1Value,
  R2Like,
  R2ObjectLike,
  TribunalBindings,
} from './bindings.js';
export { base64Of, bytesOf } from './bindings.js';
export { SCHEMA, SCHEMA_VERSION, applySchema } from './schema.js';
