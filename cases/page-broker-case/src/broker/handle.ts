// The types a test sees: one handle per arrived fragment, its actions chained,
// its leads typed by the outcomes they declare.
import type { AnyFragment, back, Fragment, Leads, Over, stay } from './contract.js';

type Rest<F> = F extends (d: any, ...args: infer P) => any ? P : never;
type Arrived<F, O> = O extends typeof stay
  ? Handle<F>
  : O extends typeof back
    ? Handle<AnyFragment>
    : O extends Over<infer C>
      ? Handle<C>
      : Handle<O>;

type Actions<F> = { [K in StayKeys<F>]: (...args: Rest<ActOf<F, K>>) => Chain<F> } & {
  [K in LeadKeys<F>]: LeadCall<F, K>;
};
type Chain<F> = Actions<F> & PromiseLike<Handle<F>>;

type SpecOf<F> = F extends Fragment<infer S> ? S : never;
type ActionsOf<F> = NonNullable<SpecOf<F>['actions']>;
type ActOf<F, K> = K extends keyof ActionsOf<F>
  ? ActionsOf<F>[K] extends { act: infer A }
    ? A
    : ActionsOf<F>[K]
  : never;
type StayKeys<F> = {
  [K in keyof ActionsOf<F>]: ActionsOf<F>[K] extends Leads ? never : K;
}[keyof ActionsOf<F>];
type LeadKeys<F> = {
  [K in keyof ActionsOf<F>]: ActionsOf<F>[K] extends Leads ? K : never;
}[keyof ActionsOf<F>];
type OutcomesOf<F, K> = K extends keyof ActionsOf<F>
  ? ActionsOf<F>[K] extends Leads<infer O> ? O : never
  : never;

interface LeadCall<F, K> {
  /** Exploratory: goes wherever the app goes. The journal marks the step unnamed. */
  (...args: Rest<ActOf<F, K>>): Promise<Arrival<F, OutcomesOf<F, K>>>;
  /** The test names the branch; any other arrival fails, naming what it found. */
  to<N extends keyof OutcomesOf<F, K> & string>(
    outcome: N,
    ...args: Rest<ActOf<F, K>>
  ): Promise<Arrived<F, OutcomesOf<F, K>[N]>>;
}
export type Arrival<F, O> = {
  [N in keyof O]: { readonly outcome: N; readonly handle: Arrived<F, O[N]> };
}[keyof O];

export type Handle<F> = Actions<F> & {
  readonly [K in keyof NonNullable<SpecOf<F>['reads']>]: (
    ...args: Rest<NonNullable<SpecOf<F>['reads']>[K]>
  ) => Promise<Awaited<ReturnType<NonNullable<SpecOf<F>['reads']>[K]>>>;
} & {
  readonly [K in keyof NonNullable<SpecOf<F>['uses']>]: Handle<NonNullable<SpecOf<F>['uses']>[K]>;
};
