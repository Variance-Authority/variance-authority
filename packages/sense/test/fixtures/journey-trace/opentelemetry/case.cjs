// The test side: OpenTelemetry as any application's tests would register it,
// exporting nothing and instrumenting `fetch`, handed over as the trace each
// case runs in. Required once per Jest worker, outside every test file's
// sandbox.
const api = require('@opentelemetry/api');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } = require('@opentelemetry/core');
const { TracerProvider } = require('@opentelemetry/sdk-trace');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
const { openTelemetry } = require('@variance-authority/sense/case-journey');

api.context.setGlobalContextManager(new AsyncLocalStorageContextManager());
api.propagation.setGlobalPropagator(
  new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] }),
);
api.trace.setGlobalTracerProvider(new TracerProvider());
registerInstrumentations({ instrumentations: [new UndiciInstrumentation()] });
module.exports = openTelemetry(api);
