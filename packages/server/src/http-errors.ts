/**
 * The three refusals this service can answer with, as throwable values.
 *
 * They live apart from `http.ts` because they are the shared vocabulary of the
 * edge, not part of any one step of it: reading a parameter, reading a body and
 * validating a write all throw these, and `handle` is the single place that turns
 * one into a status code. Keeping the classes here is what lets the parser and
 * the request readers stay independent of each other — both depend on the
 * refusals, neither depends on the other.
 *
 * Anything not listed here reaches the caller as a 500 with its message, because
 * the client turns a non-2xx into a thrown error precisely so a broken service
 * cannot become the sentence "nothing has drifted".
 */

/** A request whose shape is wrong: answered 400, with the field named. */
export class BadRequest extends Error {
  override readonly name = 'BadRequest';
}

export class PayloadTooLarge extends Error {
  override readonly name = 'PayloadTooLarge';
}

/**
 * The right method on a real route, answered 405 rather than 404.
 *
 * The distinction only exists past authentication, so it reveals nothing; and it
 * is worth keeping, because a `GET` against the write route is a client built
 * against a different version of this API, and 404 would send whoever wrote it
 * looking for a typo in the path.
 */
export class MethodNotAllowed extends Error {
  override readonly name = 'MethodNotAllowed';
  constructor(
    message: string,
    readonly allow: string,
  ) {
    super(message);
  }
}
