import { crossingOf, type Crossing } from '../ask-args.js';
import { OperatorError } from '../exit.js';
import type { AskRequest } from './ask.js';

/** The flags every question is spelled with, whichever subject answers it. */
export type Flagged = Crossing & Pick<
  AskRequest,
  | 'subject' | 'subjects' | 'component' | 'rule' | 'shape' | 'test' | 'state' | 'build' | 'file' | 'files' | 'area' | 'declarations'
  | 'name' | 'line' | 'package' | 'subpath' | 'query'
  | 'under' | 'above' | 'inside' | 'beside' | 'leftOf' | 'rightOf' | 'on'
  | 'from' | 'to' | 'over' | 'after' | 'limit' | 'offset' | 'story' | 'claims'
>;

/**
 * The flags, and only the flags, off a request. Named one by one rather than
 * spread, because a request also carries what it is *about* — a report path, a
 * watcher address, a reader — and `inputFor` names every property it does
 * not recognise as ignored, which is the right rule for a flag and the wrong
 * one for a subject.
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
    declarations: request.declarations,
    name: request.name,
    line: request.line,
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
    over: request.over,
    after: request.after,
    limit: request.limit,
    offset: request.offset,
    story: request.story,
    // A path, never read here: a question that takes it reads it over this one.
    claims: request.claims,
    ...crossingOf(request),
  };
}

/** Refuse arguments with no question before either dispatcher reads a subject. */
export function unasked(request: Flagged & Pick<AskRequest, 'unknown' | 'changedFile' | 'taintFile' | 'at' | 'format'>): void {
  const input = {
    ...flagged(request),
    changedFile: request.changedFile,
    taintFile: request.taintFile,
    at: request.at,
    format: request.format,
  };
  if (Object.values(input).some((value) => value !== undefined) || (request.unknown?.length ?? 0) > 0) {
    throw new OperatorError('`variance ask` needs a question before its arguments. Use `variance ask <question> ...`; run `variance ask` to list questions.');
  }
}
