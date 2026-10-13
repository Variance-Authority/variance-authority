import type { SubjectRef } from './capture.js';
import type { RenderDocument } from './document.js';
import type { SemanticSnapshot } from './snapshot.js';

/**
 * Whether a value read back from a file or a store is the format it claims.
 *
 * Read, not believed: a value parsed from JSON is `unknown` until one of these
 * says otherwise, and each checks every field its type declares, so that there
 * is one answer to what a snapshot, a document or a subject is. What a reader
 * can re-derive, a digest against the bytes it names, is the reader's to check.
 */

/**
 * Whether a value is a `SemanticSnapshot`, every node down to the leaves.
 *
 * The readers walk all of it: the matcher pairs every child, and a node that is
 * not one throws there instead of reading as a snapshot that is not recorded.
 * A capture file and a packed snapshot are the two places one is read back.
 * Whose snapshot it is, against the subject it was filed under, is the
 * reader's question.
 */
export function isSemanticSnapshot(value: unknown): value is SemanticSnapshot {
  const snapshot = record(value);
  const profile = snapshot === null ? null : record(snapshot.profile);
  const environment = snapshot === null ? null : record(snapshot.environment);
  const root = snapshot === null ? null : record(snapshot.root);
  return (
    snapshot !== null &&
    snapshot.formatVersion === 1 &&
    isSubjectRef(snapshot.subject) &&
    profile !== null &&
    (profile.id === 'jsdom' || profile.id === 'chromium') &&
    ['ariaTree', 'declaredStyle', 'computedStyle', 'layout', 'raster'].every(
      (field) => typeof profile[field] === 'boolean',
    ) &&
    environment !== null &&
    typeof environment.digest === 'string' &&
    typeof environment.semanticDigest === 'string' &&
    environmentInputsShape(environment.inputs) &&
    typeof snapshot.renderHash === 'string' &&
    typeof snapshot.structureHash === 'string' &&
    typeof snapshot.styleHash === 'string' &&
    root !== null &&
    semanticNodeShape(root) &&
    Array.isArray(snapshot.styleProvenance) &&
    snapshot.styleProvenance.every(styleProvenanceShape) &&
    (snapshot.ignoreSites === undefined ||
      (Array.isArray(snapshot.ignoreSites) && snapshot.ignoreSites.every(ignoreSiteShape))) &&
    diagnosticArray(snapshot.diagnostics)
  );
}

/**
 * Whether a value is a `RenderDocument`, its resources' shape included.
 *
 * Shape only: that a resource's bytes are base64 and hash to its digest, and
 * that a document is resource-closed, are what a reader that needs them checks.
 */
export function isRenderDocument(value: unknown): value is RenderDocument {
  const document = record(value);
  const frame = document === null ? null : record(document.frame);
  const viewport = document === null ? null : record(document.viewport);
  return (
    document !== null &&
    document.documentVersion === 1 &&
    isSubjectRef(document.subject) &&
    typeof document.html === 'string' &&
    frame !== null &&
    stringRecord(frame.html) &&
    stringRecord(frame.body) &&
    Array.isArray(frame.ancestors) &&
    frame.ancestors.every(frameElementShape) &&
    (frame.containerWidth === undefined || finiteNumber(frame.containerWidth)) &&
    stringArray(document.css) &&
    viewport !== null &&
    finiteNumber(viewport.width) &&
    finiteNumber(viewport.height) &&
    finiteNumber(viewport.deviceScaleFactor) &&
    (viewport.colorScheme === 'light' || viewport.colorScheme === 'dark') &&
    stringRecord(document.inherited) &&
    stringArray(document.fonts) &&
    (document.assets === undefined || stringRecord(document.assets)) &&
    optionalString(document.baseUrl) &&
    (document.resources === undefined ||
      (record(document.resources) !== null && Object.values(document.resources as object).every(resourceShape))) &&
    diagnosticArray(document.diagnostics)
  );
}

/** Whether a value is a `SubjectRef`: an id, one of the four kinds, and an optional title. */
export function isSubjectRef(value: unknown): value is SubjectRef {
  const subject = record(value);
  return subject !== null &&
    typeof subject.id === 'string' &&
    ['story', 'route', 'fixture', 'value'].includes(String(subject.kind)) &&
    optionalString(subject.title);
}

function frameElementShape(value: unknown): boolean {
  const element = record(value);
  return element !== null && typeof element.tag === 'string' && stringRecord(element.attributes);
}

function resourceShape(value: unknown): boolean {
  const resource = record(value);
  return resource !== null &&
    typeof resource.contentType === 'string' &&
    typeof resource.bytes === 'string' &&
    typeof resource.digest === 'string' &&
    (resource.status === undefined || finiteNumber(resource.status));
}

function environmentInputsShape(value: unknown): boolean {
  const inputs = record(value);
  const viewport = inputs === null ? null : record(inputs.viewport);
  return inputs !== null &&
    (inputs.profile === 'jsdom' || inputs.profile === 'chromium') &&
    typeof inputs.engine === 'string' &&
    typeof inputs.ruleset === 'string' &&
    typeof inputs.allowlist === 'string' &&
    viewport !== null &&
    finiteNumber(viewport.width) &&
    finiteNumber(viewport.height) &&
    finiteNumber(viewport.deviceScaleFactor) &&
    (viewport.colorScheme === 'light' || viewport.colorScheme === 'dark') &&
    stringArray(inputs.fonts) &&
    scalarRecord(inputs.conditions) &&
    stringRecord(inputs.assets) &&
    optionalString(inputs.stabilization);
}

function styleProvenanceShape(value: unknown): boolean {
  const entry = record(value);
  if (entry === null ||
    typeof entry.path !== 'string' ||
    typeof entry.property !== 'string' ||
    typeof entry.sheet !== 'string' ||
    typeof entry.selector !== 'string' ||
    !optionalString(entry.tokenName)) return false;
  if (entry.source === undefined) return true;
  const source = record(entry.source);
  return source !== null && typeof source.file === 'string' && finiteNumber(source.line);
}

function semanticNodeShape(node: Record<string, unknown>): boolean {
  return (
    typeof node.path === 'string' &&
    typeof node.tag === 'string' &&
    optionalString(node.alias) &&
    optionalString(node.role) &&
    optionalString(node.name) &&
    optionalString(node.description) &&
    (node.state === undefined || scalarRecord(node.state)) &&
    stringRecord(node.attributes) &&
    stringRecord(node.style) &&
    (node.tokens === undefined || stringRecord(node.tokens)) &&
    (node.styleTokens === undefined || stringRecord(node.styleTokens)) &&
    (node.rect === undefined || rectShape(node.rect)) &&
    optionalString(node.text) &&
    (node.provenance === undefined || provenanceShape(node.provenance)) &&
    (node.wiring === undefined || wiringShape(node.wiring)) &&
    (node.portalled === undefined || typeof node.portalled === 'boolean') &&
    (node.ignoredBy === undefined || stringArray(node.ignoredBy)) &&
    optionalString(node.unread) &&
    Array.isArray(node.children) &&
    node.children.every((child) => {
      const parsed = record(child);
      return parsed !== null && semanticNodeShape(parsed);
    })
  );
}

function ignoreSiteShape(value: unknown): boolean {
  const site = record(value);
  return site !== null &&
    typeof site.path === 'string' &&
    typeof site.rule === 'string' &&
    (site.rect === undefined || rectShape(site.rect));
}

function rectShape(value: unknown): boolean {
  const rect = record(value);
  return rect !== null &&
    finiteNumber(rect.x) &&
    finiteNumber(rect.y) &&
    finiteNumber(rect.width) &&
    finiteNumber(rect.height);
}

function provenanceShape(value: unknown): boolean {
  const provenance = record(value);
  return provenance !== null &&
    Array.isArray(provenance.owners) &&
    provenance.owners.every(ownerShape) &&
    optionalString(provenance.createdBy) &&
    (provenance.source === undefined || sourceLocationShape(provenance.source)) &&
    (provenance.stack === undefined ||
      (Array.isArray(provenance.stack) && provenance.stack.every(stackFrameShape)));
}

function ownerShape(value: unknown): boolean {
  const owner = record(value);
  return owner !== null &&
    typeof owner.name === 'string' &&
    typeof owner.propsDigest === 'string' &&
    optionalString(owner.createdBy);
}

function sourceLocationShape(value: unknown): boolean {
  const source = record(value);
  return source !== null &&
    typeof source.file === 'string' &&
    finiteNumber(source.line) &&
    finiteNumber(source.column);
}

function stackFrameShape(value: unknown): boolean {
  const frame = record(value);
  return frame !== null &&
    typeof frame.url === 'string' &&
    finiteNumber(frame.line) &&
    finiteNumber(frame.column) &&
    optionalString(frame.function);
}

function wiringShape(value: unknown): boolean {
  const wiring = record(value);
  return wiring !== null &&
    (wiring.hooks === undefined || stringArray(wiring.hooks)) &&
    (wiring.wrappers === undefined ||
      (Array.isArray(wiring.wrappers) &&
        wiring.wrappers.every((entry) => entry === 'memo' || entry === 'forwardRef'))) &&
    (wiring.contexts === undefined || stringArray(wiring.contexts)) &&
    optionalString(wiring.key);
}

function diagnosticArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => {
    const diagnostic = record(entry);
    return diagnostic !== null &&
      (diagnostic.severity === 'warn' || diagnostic.severity === 'error') &&
      typeof diagnostic.code === 'string' &&
      typeof diagnostic.message === 'string' &&
      optionalString(diagnostic.nodePath);
  });
}

// A plain object. `@variance-authority/unit-test`'s capture-file reader keeps
// the same guard privately: it is re-typed in several packages and has no
// exported owner, and exporting it from here would make it part of the format.
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecord(value: unknown): boolean {
  const parsed = record(value);
  return parsed !== null && Object.values(parsed).every((entry) => typeof entry === 'string');
}

function scalarRecord(value: unknown): boolean {
  const parsed = record(value);
  return parsed !== null && Object.values(parsed).every(
    (entry) => ['string', 'boolean', 'number'].includes(typeof entry) &&
      (typeof entry !== 'number' || Number.isFinite(entry)),
  );
}

function stringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
