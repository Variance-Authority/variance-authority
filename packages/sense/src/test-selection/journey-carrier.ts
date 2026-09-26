/**
 * What carries a journey across a fence to a head: the cookie a case puts on its
 * request, or the trace the application already propagates.
 */

import { JOURNEY_COOKIE } from '@variance-authority/wire';
import journeyTrace from './journey-trace.cjs';

/**
 * Read a journey back out of a `Cookie` header.
 *
 * The header is the one place a head is guaranteed to have, whatever framework
 * sits above it. A head with a request-scoped cookie accessor of its own should
 * use that and pass the value straight to `JourneyCollector.enter`.
 */
export function journeyOf(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const pair of cookieHeader.split(';')) {
    const equals = pair.indexOf('=');
    if (equals < 0) continue;
    if (pair.slice(0, equals).trim() !== JOURNEY_COOKIE) continue;
    const value = pair.slice(equals + 1).trim();
    return value.length === 0 ? undefined : value;
  }
  return undefined;
}

/**
 * Who carries a journey across a fence, and how to ask it which one is running:
 * `sentry(Sentry)` or `openTelemetry(api)`, or anything else that can.
 */
export interface JourneyTrace {
  /** What the trace is, for a message that has to name it. */
  readonly name: string;
  /** Run a case's body inside a trace whose id is `journey`, 32 lowercase hex digits. */
  carry<Result>(journey: string, name: string, body: () => Result): Result;
  /** The trace id running now, or `undefined` where there is none. */
  current(): string | undefined;
}

/** The part of `@sentry/node`, or any Sentry SDK from 8 on, a journey reads. */
export interface SentrySdk {
  getActiveSpan(): { spanContext(): { traceId: string } } | undefined;
  getCurrentScope(): { getPropagationContext(): { traceId: string } };
  continueTrace<Result>(headers: { sentryTrace?: string }, callback: () => Result): Result;
  startSpan<Result>(options: { name: string; forceTransaction?: boolean }, callback: () => Result): Result;
}

/** The part of `@opentelemetry/api` a journey reads. */
export interface OpenTelemetryApi {
  context: {
    active(): object;
    with<Result>(context: never, body: () => Result): Result;
  };
  trace: {
    getSpanContext(context: never): { traceId: string } | undefined;
    setSpanContext(
      context: never,
      span: { traceId: string; spanId: string; traceFlags: number; isRemote?: boolean },
    ): object;
  };
}

/** The application's tracing, as a journey carrier. */
export const { sentry, openTelemetry } = journeyTrace;
