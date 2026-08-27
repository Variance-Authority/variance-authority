/**
 * Say that a failure is the operator's to fix, not a bug in the tool.
 *
 * A collector is loaded by dynamic import from the adopter's own
 * `node_modules`, so it cannot share an error *class* with whatever runs it —
 * `instanceof` across two installed copies is `false`, and the misconfigured
 * suite would be told it has found a defect. The contract is therefore a
 * property name, which survives the boundary the way a header name does.
 *
 * Use it for anything the reader can act on: a config that names two plans, a
 * sitemap that answered 404, a route with no id. Leave a bare `Error` where the
 * cause really is this package — a missing bundle it was supposed to build is
 * not something an adopter can repair, and dressing it up as their problem
 * sends them to edit a config that was never wrong.
 */
export function operatorError(message: string, options?: ErrorOptions): Error {
  return Object.assign(new Error(message, options), { varianceOperatorError: true });
}
