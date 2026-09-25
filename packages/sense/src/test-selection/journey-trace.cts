/**
 * A journey that rides the trace the application already carries.
 *
 * The cookie is the carrier a run brings itself, and past the first hop it is
 * only as far as somebody forwards it. An application that runs Sentry or
 * OpenTelemetry already forwards a trace id across every fence it has, because
 * forwarding it is the whole job of those SDKs. So the journey *is* the trace
 * id: the case runs inside a trace whose id is its journey, and a head asks the
 * same SDK which trace is running. Nothing here touches a request, patches a
 * transport or registers a propagator. The SDK instance is handed in, so it is
 * the application's own, initialized its own way, in its own realm.
 *
 * A trace the case did not start — one the SDK opened at import, or a request
 * from outside the run — is a journey no case handed out, and the fold charges
 * it to every case that head served, as it does work under no journey at all.
 *
 * CommonJS so a test file reaches it from inside Jest's sandbox whatever it was
 * compiled to.
 */

import type { JourneyTrace, OpenTelemetryApi, SentrySdk } from './journey.js';

const INVALID_TRACE = '00000000000000000000000000000000';

function spanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0');
  return id;
}

/**
 * The journey as a Sentry trace. Pass the SDK namespace the application
 * initialized: `sentry(Sentry)`.
 *
 * A case continues a trace with no sampling decision, so what the SDK sends is
 * whatever `tracesSampleRate` already says. The id travels the same with
 * tracing on, sampled out or off: with no span it rides the scope.
 */
function sentry(sdk: SentrySdk): JourneyTrace {
  return {
    name: 'sentry',
    carry: (journey, name, body) =>
      sdk.continueTrace({ sentryTrace: `${journey}-${spanId()}` }, () =>
        sdk.startSpan({ name, forceTransaction: true }, body)),
    current: () =>
      sdk.getActiveSpan()?.spanContext().traceId ?? sdk.getCurrentScope().getPropagationContext().traceId,
  };
}

/**
 * The journey as an OpenTelemetry trace. Pass the API the application
 * registered its SDK with: `openTelemetry(api)`.
 *
 * A case runs under a remote parent whose id is its journey, sampled, so the
 * instrumentation below it records and injects as it would for any request.
 */
function openTelemetry(api: OpenTelemetryApi): JourneyTrace {
  return {
    name: 'opentelemetry',
    carry: (journey, _name, body) =>
      api.context.with(
        api.trace.setSpanContext(api.context.active() as never, {
          traceId: journey,
          spanId: spanId(),
          traceFlags: 1,
          isRemote: true,
        }) as never,
        body,
      ),
    current: () => {
      const traceId = api.trace.getSpanContext(api.context.active() as never)?.traceId;
      return traceId === undefined || traceId === INVALID_TRACE ? undefined : traceId;
    },
  };
}

export = { sentry, openTelemetry };
