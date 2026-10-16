/**
 * Why a subject is in the report without an observation.
 *
 * Three kinds, because they mean different things about whether anyone should
 * act. `excluded` is a decision the operator made and wrote down; `failed` is a
 * hole in coverage, and collapsing the two makes every exclusion permanently red
 * or a crash on subject 41 look chosen. `unreached` is neither: the run read the
 * diff against what each baseline records having rendered and concluded this
 * change cannot arrive. Calling that a decision reports one nobody made.
 */
export type NotObservedKind = 'excluded' | 'failed' | 'unreached';

/** One subject the run names without observing it, with the kind and the sentence why. */
export interface NotObserved {
  readonly subject: string;
  readonly kind: NotObservedKind;
  /** One sentence, ready to print, naming what was not looked at and why. */
  readonly because: string;
}
