import {
  canonicalize,
  digestValue,
  type CanonicalValue,
  type Digest,
  type SemanticSnapshot,
} from '@variance-authority/core';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ScenarioDefinitionData,
  ScenarioExecutionData,
  ScenarioRun,
} from './contract.js';
import { checkedDefinition, checkedExecution, checkedRun } from './contract.js';
import { assertScenarioRun, semanticSnapshotDigest } from './execution.js';

export interface ScenarioArchiveAddress {
  readonly project: string;
  readonly run: string;
  readonly scenario: string;
  readonly execution: string;
  readonly precondition: string;
  readonly profile: string;
  readonly attempt: string;
}

export type ScenarioArchiveAdmission =
  | { readonly kind: 'admitted' }
  | { readonly kind: 'refused'; readonly because: string };

export interface ScenarioArchivePolicy {
  /** ISO-8601 instant after which the evidence is unavailable. */
  readonly retainUntil: string;
  /** Human-readable declaration of who may read the retained semantic text. */
  readonly access: string;
  /** Human-readable declaration of how retained evidence is deleted. */
  readonly deletion: string;
  readonly admit: (snapshot: SemanticSnapshot) => ScenarioArchiveAdmission;
}

export interface ScenarioArchiveManifest {
  readonly archiveVersion: 1;
  readonly address: ScenarioArchiveAddress;
  readonly retainUntil: string;
  readonly access: string;
  readonly deletion: string;
  readonly definition: ScenarioDefinitionData;
  readonly execution: ScenarioExecutionData;
  readonly snapshots: readonly Digest[];
}

export type ArchivedScenario =
  | { readonly kind: 'observed'; readonly run: ScenarioRun; readonly manifest: ScenarioArchiveManifest }
  | { readonly kind: 'unobserved'; readonly because: string };

export interface ScenarioArchiveCollection {
  readonly manifests: number;
  readonly snapshots: number;
}

export interface ScenarioArchive {
  put(
    address: ScenarioArchiveAddress,
    run: ScenarioRun,
    policy: ScenarioArchivePolicy,
  ): Promise<ScenarioArchiveManifest>;
  read(address: ScenarioArchiveAddress): Promise<ArchivedScenario>;
  collectExpired(): Promise<ScenarioArchiveCollection>;
}

export interface ScenarioArchiveOptions {
  readonly root: string;
  readonly now?: () => Date;
}

/**
 * Open an opt-in, text-only archive. Nothing calls this from the default execution path.
 *
 * The archive accepts only `SemanticSnapshot` objects and a scenario manifest; its API has no
 * raster, document, event payload, baseline, or history-row write.
 */
export function createScenarioArchive(options: ScenarioArchiveOptions): ScenarioArchive {
  const root = options.root;
  const now = options.now ?? (() => new Date());
  const objects = join(root, 'objects');
  const manifests = join(root, 'manifests');

  return {
    async put(address, run, policy) {
      assertScenarioRun(run);
      validateAddress(address, run);
      const expires = parseExpiry(policy.retainUntil);
      if (expires <= now().getTime()) {
        throw new Error('refusing scenario archive policy whose retention has already expired');
      }
      requireDeclaration(policy.access, 'access');
      requireDeclaration(policy.deletion, 'deletion');

      const digests = observedDigests(run.execution);
      for (const digest of digests) {
        const snapshot = run.snapshots.get(digest);
        if (snapshot === undefined) {
          throw new Error(`refusing scenario archive with unavailable snapshot ${digest}`);
        }
        const admission = policy.admit(snapshot);
        if (admission.kind === 'refused') {
          throw new Error(`refusing semantic snapshot ${digest}: ${admission.because}`);
        }
        if (semanticSnapshotDigest(snapshot) !== digest) {
          throw new Error(`refusing semantic snapshot ${digest}: its content address does not match`);
        }
      }

      await mkdir(objects, { recursive: true });
      await mkdir(manifests, { recursive: true });
      for (const digest of digests) {
        await writeObject(join(objects, `${fileDigest(digest)}.json`), run.snapshots.get(digest)!);
      }

      const manifest: ScenarioArchiveManifest = {
        archiveVersion: 1,
        address,
        retainUntil: policy.retainUntil,
        access: policy.access,
        deletion: policy.deletion,
        definition: run.definition,
        execution: run.execution,
        snapshots: digests,
      };
      await writeAtomic(manifestPath(manifests, address), canonicalize(asCanonical(manifest)));
      return manifest;
    },

    async read(address) {
      const path = manifestPath(manifests, address);
      const manifest = await readOptional<ScenarioArchiveManifest>(path);
      if (manifest === undefined) {
        return { kind: 'unobserved', because: 'no archived scenario exists at this address' };
      }
      if (parseExpiry(manifest.retainUntil) <= now().getTime()) {
        return {
          kind: 'unobserved',
          because: `the archived scenario expired at ${manifest.retainUntil}`,
        };
      }

      const snapshots = new Map<Digest, SemanticSnapshot>();
      for (const digest of manifest.snapshots) {
        const snapshot = await readOptional<SemanticSnapshot>(
          join(objects, `${fileDigest(digest)}.json`),
        );
        if (snapshot === undefined) {
          return {
            kind: 'unobserved',
            because: `archived semantic snapshot ${digest} is unavailable`,
          };
        }
        if (semanticSnapshotDigest(snapshot) !== digest) {
          throw new Error(`archived semantic snapshot ${digest} failed its content address`);
        }
        snapshots.set(digest, snapshot);
      }

      const run = checkedRun({
        definition: checkedDefinition(manifest.definition),
        execution: checkedExecution(manifest.execution),
        snapshots,
      });
      assertScenarioRun(run);
      return {
        kind: 'observed',
        manifest,
        run,
      };
    },

    async collectExpired() {
      const manifestFiles = await jsonFiles(manifests);
      const retained = new Set<Digest>();
      let removedManifests = 0;

      for (const file of manifestFiles) {
        const manifest = await readRequired<ScenarioArchiveManifest>(join(manifests, file));
        if (parseExpiry(manifest.retainUntil) <= now().getTime()) {
          await rm(join(manifests, file));
          removedManifests += 1;
        } else {
          for (const digest of manifest.snapshots) retained.add(digest);
        }
      }

      let removedSnapshots = 0;
      for (const file of await jsonFiles(objects)) {
        const snapshot = await readRequired<SemanticSnapshot>(join(objects, file));
        const digest = semanticSnapshotDigest(snapshot);
        if (!retained.has(digest)) {
          await rm(join(objects, file));
          removedSnapshots += 1;
        }
      }
      return { manifests: removedManifests, snapshots: removedSnapshots };
    },
  };
}

function observedDigests(execution: ScenarioExecutionData): readonly Digest[] {
  return [...new Set(
    execution.frames.flatMap((frame) =>
      frame.outcome.kind === 'observed' ? [frame.outcome.snapshot] : [],
    ),
  )].sort(compare);
}

function validateAddress(address: ScenarioArchiveAddress, run: ScenarioRun): void {
  const mismatches = [
    address.scenario === run.definition.id ? undefined : 'scenario',
    address.execution === run.execution.id ? undefined : 'execution',
    address.precondition === run.execution.precondition.id ? undefined : 'precondition',
    address.profile === run.execution.profile ? undefined : 'profile',
  ].filter((field): field is string => field !== undefined);
  if (mismatches.length > 0) {
    throw new Error(`refusing scenario archive address with mismatched ${mismatches.join(', ')}`);
  }
  for (const [field, value] of Object.entries(address)) requireDeclaration(value, field);
}

function parseExpiry(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`invalid scenario retention instant: ${value}`);
  return timestamp;
}

function requireDeclaration(value: string, what: string): void {
  if (value.trim() === '') throw new Error(`scenario archive ${what} must not be empty`);
}

function manifestPath(root: string, address: ScenarioArchiveAddress): string {
  return join(root, `${fileDigest(digestValue(asCanonical(address)))}.json`);
}

function fileDigest(digest: Digest): string {
  return digest.replace(':', '-');
}

function asCanonical(value: unknown): CanonicalValue {
  return value as CanonicalValue;
}

async function writeObject(path: string, snapshot: SemanticSnapshot): Promise<void> {
  const content = canonicalize(asCanonical(snapshot));
  const existing = await readText(path);
  if (existing !== undefined) {
    if (existing !== content) throw new Error(`content-address collision at ${path}`);
    return;
  }
  await writeAtomic(path, content);
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function readOptional<T>(path: string): Promise<T | undefined> {
  const text = await readText(path);
  return text === undefined ? undefined : (JSON.parse(text) as T);
}

async function readRequired<T>(path: string): Promise<T> {
  const found = await readOptional<T>(path);
  if (found === undefined) throw new Error(`archive entry disappeared while reading ${path}`);
  return found;
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function jsonFiles(path: string): Promise<readonly string[]> {
  try {
    return (await readdir(path)).filter((file) => file.endsWith('.json')).sort(compare);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: string }).code === 'ENOENT'
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
