import type { CaptureArtifact } from '@variance-authority/core';
import { captureFiles, readCapture } from './archive.js';
import type { Collector, SubjectSource } from './contract.js';

export interface CaptureCollectorOptions {
  readonly directory: string;
}

/** Read browserless unit-test captures in a later `variance run` process. */
export function captureCollector(options: CaptureCollectorOptions): SubjectSource {
  return async (): Promise<Collector> => {
    const artifacts = new Map<string, CaptureArtifact>();

    const load = async (): Promise<void> => {
      if (artifacts.size > 0) return;
      for (const path of await captureFiles(options.directory)) {
        const artifact = await readCapture(path);
        if (artifacts.has(artifact.subject.id)) {
          throw new Error(`capture directory contains duplicate subject ${artifact.subject.id}`);
        }
        artifacts.set(artifact.subject.id, artifact);
      }
      if (artifacts.size === 0) {
        throw new Error(`capture directory ${options.directory} contains no capture artifacts`);
      }
    };

    return {
      async plan() {
        await load();
        return {
          subjects: [...artifacts.values()].map((artifact) => ({
            subject: artifact.subject,
            ...(artifact.material.kind === 'document'
              ? { viewport: artifact.material.document.viewport }
              : {}),
          })),
          notObserved: [],
          warnings: [],
        };
      },

      async collect(subject) {
        await load();
        const artifact = artifacts.get(subject.subject.id);
        if (artifact === undefined) {
          return { ok: false, because: `no capture artifact for ${subject.subject.id}` };
        }
        if (artifact.material.kind !== 'document') {
          return { ok: false, because: `${subject.subject.id} is not a document capture` };
        }
        return {
          ok: true,
          document: artifact.material.document,
          ...(artifact.snapshot === undefined ? {} : { snapshot: artifact.snapshot }),
          ...(artifact.source === undefined ? {} : { source: artifact.source }),
          ...(artifact.stabilization === undefined
            ? {}
            : { stabilization: artifact.stabilization }),
        };
      },

      async close() {},
    };
  };
}
