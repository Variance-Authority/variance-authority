/**
 * Replacing one hook of a resolved Vite plugin, as the probes watch every
 * other plugin and as a collector edits one plugin's answer.
 */

/** A plugin as Vite resolves it, as far as a hook is replaced on one. */
export interface HookedPlugin {
  readonly name: string;
  transform?: unknown;
  load?: unknown;
}

/**
 * What runs after the plugin's own handler, with the context and arguments it
 * was called with and what it answered, settled where it answered a promise.
 * What this returns is the hook's answer.
 */
export type AfterHook = (this: object, answer: unknown, args: readonly unknown[]) => unknown;

/**
 * Replace `plugin`'s `hook` with one that calls the plugin's own handler and
 * hands its answer to `then`. A function hook is replaced; an object hook
 * keeps its `order` and `filter`, and only its `handler` changes. Answers
 * whether there was a handler to replace.
 */
export function afterHook(plugin: HookedPlugin, hook: 'transform' | 'load', then: AfterHook): boolean {
  const value = plugin[hook];
  if (typeof value === 'function') {
    plugin[hook] = after(value as Handler, then);
    return true;
  }
  if (typeof value === 'object' && value !== null && typeof (value as { handler?: unknown }).handler === 'function') {
    const object = value as { handler: Handler };
    plugin[hook] = { ...object, handler: after(object.handler, then) };
    return true;
  }
  return false;
}

type Handler = (this: object, ...args: unknown[]) => unknown;

function after(handler: Handler, then: AfterHook): Handler {
  return function (this: object, ...args) {
    const answer = handler.apply(this, args);
    if (typeof (answer as PromiseLike<unknown> | undefined)?.then === 'function') {
      return (answer as PromiseLike<unknown>).then((value) => then.call(this, value, args));
    }
    return then.call(this, answer, args);
  };
}
