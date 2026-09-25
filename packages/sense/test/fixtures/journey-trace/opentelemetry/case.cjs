// The test side: OpenTelemetry as any application's tests would register it,
// exporting nothing and instrumenting `fetch`, then one line that hands it the
// journeys.
const api = require('@opentelemetry/api');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');
const { carryJourneys, openTelemetry } = require('@variance-authority/sense/case-journey');

new NodeTracerProvider().register();
registerInstrumentations({ instrumentations: [new UndiciInstrumentation()] });
carryJourneys(openTelemetry(api));
