import { crossingOf, type Crossing } from '../ask-args.js';
import type { AskRequest } from './ask.js';

/** The flags every question is spelled with, whichever subject answers it. */
export type Flagged = Crossing & Pick<
  AskRequest,
  | 'subject' | 'subjects' | 'component' | 'rule' | 'shape' | 'test' | 'state' | 'build' | 'file' | 'files' | 'area'
  | 'name' | 'package' | 'subpath' | 'query'
  | 'under' | 'above' | 'inside' | 'beside' | 'leftOf' | 'rightOf' | 'on'
  | 'from' | 'to' | 'limit' | 'offset'
>;

/**
 * The flags, and only the flags, off a request. Named one by one rather than
 * spread, because a request also carries what it is *about* — a report path, a
 * watcher address, a reader — and `inputFor` refuses every property it does
 * not recognise, which is the right rule for a flag and the wrong one for a
 * subject.
 */
export function flagged(request: Flagged): Readonly<Record<string, unknown>> {
  return {
    subject: request.subject,
    subjects: request.subjects,
    component: request.component,
    rule: request.rule,
    shape: request.shape,
    test: request.test,
    state: request.state,
    build: request.build,
    file: request.file,
    files: request.files,
    area: request.area,
    name: request.name,
    package: request.package,
    subpath: request.subpath,
    query: request.query,
    under: request.under,
    above: request.above,
    inside: request.inside,
    beside: request.beside,
    leftOf: request.leftOf,
    rightOf: request.rightOf,
    on: request.on,
    from: request.from,
    to: request.to,
    limit: request.limit,
    offset: request.offset,
    ...crossingOf(request),
  };
}
