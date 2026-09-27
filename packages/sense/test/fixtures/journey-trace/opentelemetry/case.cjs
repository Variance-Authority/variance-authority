// The test side: OpenTelemetry as any application's tests would register it,
// exporting nothing and instrumenting `fetch`, handed over as the trace each
// case runs in. Required once per Jest worker, outside every test file's
// sandbox.
const api = require('@opentelemetry/api');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
const { openTelemetry } = require('@variance-authority/sense/case-journey');

new NodeTracerProvider().register();
registerInstrumentations({ instrumentations: [new UndiciInstrumentation()] });
module.exports = openTelemetry(api);
