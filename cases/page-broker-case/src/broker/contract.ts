// The contract a test is written against: fragments, their actions and reads,
// and where each action may lead. Declaring one checks what the page could not.
import type { Driver, ReadDriver, Where } from './driver.js';

// ── the contract ──

export type Act = (d: Driver, ...args: any[]) => Promise<unknown>;
export type Read = (r: ReadDriver, ...args: any[]) => Promise<unknown>;

/** The action leaves the fragment where it is; this is the default. */
export const stay = Symbol('stay');
/** The action closes a fragment that arrived `over` another, returning to what it covered. */
export const back = Symbol('back');

/**
 * The outcome opens over the departing fragment instead of replacing it: the
 * covered handle may still be read, and acts again once the cover goes `back`.
 * Covering is the edge's, not the dialog's: one dialog can cover many pages.
 */
export interface Over<F extends AnyFragment = AnyFragment> {
  readonly cover: F;
}
export const over = <F extends AnyFragment>(cover: F): Over<F> => ({ cover });

export interface Stays<A extends Act = Act> {
  readonly kind: 'stays';
  readonly act: A;
  /** Holds the action open until the app says its effect landed. */
  readonly until?: Until;
}
export interface Leads<O extends Outcomes = Outcomes, A extends Act = Act> {
  readonly kind: 'leads';
  readonly outcomes: O;
  readonly act: A;
}
export type Outcomes = Record<string, AnyFragment | Over | typeof stay | typeof back>;

/** A value read before the action, and the condition on it the action waits for. */
export interface Until {
  readonly read: Read;
  readonly done: (before: unknown, now: unknown) => boolean;
}
export const changed = (read: Read): Until => ({ read, done: (before, now) => before !== now });

export const stays = <A extends Act>(act: A, options: { until?: Until } = {}): Stays<A> => ({
  kind: 'stays',
  act,
  until: options.until,
});
export const leads = <O extends Outcomes, A extends Act>(outcomes: O, act: A): Leads<O, A> => {
  // Arrival is sensed by where it lands, so two outcomes landing alike would leave the order to decide.
  const keys = Object.keys(outcomes);
  const at = keys.map((key) => {
    const to = outcomes[key];
    return to === stay ? 'stay' : to === back ? 'back' : 'cover' in to ? to.cover.name : (to as AnyFragment).name;
  });
  const twice = keys.findIndex((_, index) => at.indexOf(at[index]) !== index);
  if (twice !== -1) {
    throw new Error(`${keys[at.indexOf(at[twice])]} and ${keys[twice]} both arrive at ${at[twice]}; nothing on the page tells them apart`);
  }
  return { kind: 'leads', outcomes, act };
};

export interface Spec {
  readonly probe: Where;
  readonly uses?: Record<string, AnyFragment>;
  readonly actions?: Record<string, Act | Stays | Leads>;
  readonly reads?: Record<string, Read>;
}

export interface Fragment<S extends Spec = Spec> {
  readonly name: string;
  readonly spec: S;
}
export type AnyFragment = Fragment<any>;

/** Every fragment declared, in order: the page is sensed through these. */
export const registry: AnyFragment[] = [];

export function fragment<const S extends Spec>(name: string, spec: S): Fragment<S> {
  // One namespace on the handle: a read and an action under one name would leave
  // the test calling whichever was assigned last.
  const names = [spec.actions, spec.reads, spec.uses].flatMap((part) => Object.keys(part ?? {}));
  const twice = names.filter((each, at) => names.indexOf(each) !== at);
  if (twice.length > 0) throw new Error(`${name} declares ${twice.join(', ')} twice`);
  // A handle with `then` is a thenable: awaiting `app.enter` would never resolve.
  if (names.includes('then')) throw new Error(`${name} declares then, which makes its handle look like a promise`);
  // The page is sensed by name: a second fragment under one would arrive wherever the first shows.
  if (registry.some((each) => each.name === name)) throw new Error(`a fragment named ${name} is already declared`);
  const made = { name, spec };
  registry.push(made);
  return made;
}
