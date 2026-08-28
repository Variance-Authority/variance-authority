/**
 * The Workers runtime's own module, typed for this deployment only.
 *
 * `cloudflare:workers` exists inside workerd and nowhere a type checker looks,
 * and the alternative — `@cloudflare/workers-types` — would pull the platform's
 * whole type surface in to describe one binding object. The package itself makes
 * the same trade with `D1Like` and `R2Like`.
 *
 * No top-level import here on purpose: a `.d.ts` with one is a module, and
 * `declare module` inside a module augments rather than declares.
 */
declare module 'cloudflare:workers' {
  export const env: import('./env').TribunalEnvironment;
}
