import type { CaptureArtifact } from '@variance-authority/core';
import {
  assetUrl,
  digestBytes,
  digestCombine,
  digestString,
  isRenderDocument,
  isSemanticSnapshot,
  isSubjectRef,
} from '@variance-authority/core/format';

/**
 * What a capture file has to be before anything is believed about it.
 *
 * Separate from the directory protocol in [`archive.ts`](./archive.ts) because
 * the two answer different questions and change for different reasons: that one
 * owns which files exist and who may replace them, this one owns whether the
 * bytes in one of them are a capture. The split is also where the size is — a
 * document carries a semantic snapshot, a resource closure and a source index.
 * The document's and the snapshot's shapes are `isRenderDocument` and
 * `isSemanticSnapshot` from `@variance-authority/core/format`, which every
 * reader of those formats asks; what is checked here is what a capture file
 * adds to them.
 *
 * Everything is re-derived rather than believed. A digest that arrived in the
 * file is recomputed from the content it claims to describe, so a baseline
 * edited by hand between runs fails here instead of comparing as though the edit
 * had been captured.
 */
export function captureArtifactFrom(value: unknown, path: string): CaptureArtifact {
  const artifact = record(value);
  if (artifact === null || artifact.artifactVersion !== 1) {
    throw new Error(`${path} is not a capture artifact version 1`);
  }
  const subject = artifact.subject;
  const material = record(artifact.material);
  if (!isSubjectRef(subject) || material === null) {
    throw new Error(`${path} is not a unit-test capture`);
  }
  if (material.kind === 'value') {
    checkValue(material.value, path);
    checkTail(artifact, subject.id, path);
    return value as CaptureArtifact;
  }
  if (material.kind !== 'document') {
    throw new Error(`${path} is not a unit-test document capture`);
  }
  const document = material.document;
  if (!isRenderDocument(document) || document.resources === undefined) {
    throw new Error(`${path} does not contain a resource-closed render document`);
  }

  if (document.subject.id !== subject.id) {
    throw new Error(`${path} has different artifact and document subjects`);
  }

  for (const [url, resource] of Object.entries(document.resources)) {
    if (!base64(resource.bytes)) throw new Error(`${path} contains an invalid resource for ${url}`);
    const actual = digestBytes(Buffer.from(resource.bytes, 'base64'));
    if (actual !== resource.digest) {
      throw new Error(`${path} contains resource bytes that do not match ${url}`);
    }
  }

  if (document.assets === undefined) throw new Error(`${path} does not declare its resource digests`);
  // An asset the page's own origin serves is keyed by its path, and its bytes
  // by the URL the page resolved it to, against the document's base.
  for (const [key, expected] of Object.entries(document.assets)) {
    const resource = document.resources[assetUrl(key, document.baseUrl)];
    if (resource === undefined || resource.digest !== expected) {
      throw new Error(`${path} has no matching archived resource for ${key}`);
    }
  }

  checkTail(artifact, subject.id, path);

  return value as CaptureArtifact;
}

function checkTail(artifact: Record<string, unknown>, subjectId: string, path: string): void {
  if (
    artifact.snapshot !== undefined &&
    !(isSemanticSnapshot(artifact.snapshot) && artifact.snapshot.subject.id === subjectId)
  ) {
    throw new Error(`${path} contains an invalid semantic snapshot`);
  }
  if (artifact.source !== undefined && !sourceShape(artifact.source)) {
    throw new Error(`${path} contains an invalid source index`);
  }
  if (artifact.stabilization !== undefined && !stringArray(artifact.stabilization)) {
    throw new Error(`${path} contains an invalid stabilization record`);
  }
  if (artifact.attempt !== undefined && !attemptShape(artifact.attempt)) {
    throw new Error(`${path} contains an invalid capture attempt`);
  }
}

/**
 * A value capture, re-derived rather than believed.
 *
 * The digest is recomputed from the text on the way in, exactly as a resource's
 * bytes are. A baseline edited by hand between runs would otherwise pass its own
 * identity check and compare as though the edit had been captured.
 */
function checkValue(value: unknown, path: string): void {
  const captured = record(value);
  if (
    captured === null ||
    typeof captured.dialect !== 'string' ||
    typeof captured.text !== 'string' ||
    typeof captured.digest !== 'string' ||
    typeof captured.recipe !== 'string' ||
    (captured.keyed !== undefined && !stringArray(captured.keyed)) ||
    (captured.generator !== undefined && !generatorShape(captured.generator))
  ) {
    throw new Error(`${path} does not contain a captured value`);
  }
  const actual = digestCombine('value/v1', [
    digestString(captured.text),
    digestString(captured.recipe),
  ]);
  if (actual !== captured.digest) {
    throw new Error(`${path} contains value text that does not match its digest`);
  }
}

function generatorShape(value: unknown): boolean {
  const generator = record(value);
  return (
    generator !== null &&
    typeof generator.name === 'string' &&
    typeof generator.version === 'string'
  );
}

// A plain object, the guard `@variance-authority/core/format`'s shape checks
// keep privately too: it is re-typed in several packages and has no exported
// owner, and exporting it from the format would make it part of the contract.
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceShape(value: unknown): boolean {
  const source = record(value);
  return source !== null && Object.values(source).every((refs) =>
    Array.isArray(refs) && refs.every((ref) => {
      const parsed = record(ref);
      return parsed !== null &&
        typeof parsed.file === 'string' &&
        finiteNumber(parsed.line) &&
        ['function', 'const', 'class'].includes(String(parsed.via));
    }),
  );
}

function attemptShape(value: unknown): boolean {
  const attempt = record(value);
  if (
    attempt === null ||
    !nonNegativeInteger(attempt.retry) ||
    !nonNegativeInteger(attempt.repeat)
  ) return false;
  if (attempt.shard === undefined) return true;
  const shard = record(attempt.shard);
  return shard !== null &&
    nonNegativeInteger(shard.index) &&
    nonNegativeInteger(shard.total) &&
    Number(shard.total) > 0 &&
    Number(shard.index) < Number(shard.total);
}

function stringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): boolean {
  return finiteNumber(value) && Number.isInteger(value) && Number(value) >= 0;
}

function base64(value: string): boolean {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').toString('base64') === value;
}
