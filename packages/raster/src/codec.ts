import {
  accessibilitySnapshot,
  type AccessibilitySnapshot,
  type ComponentHash,
  type Raster,
} from '@variance-authority/core';
import { identityFrom, recordFrom } from './store.js';

/** Read the verdict-bearing sidecar shared by disk, wire, and bucket stores. */
export function sidecarFrom(value: unknown): Omit<Raster, 'bytes'> | null {
  const sidecar = recordFrom(value);
  if (sidecar === null) return null;

  const identity = identityFrom(sidecar.identity);
  const missingFonts = stringsFrom(sidecar.missingFonts);
  if (
    identity === null ||
    missingFonts === null ||
    typeof sidecar.documentDigest !== 'string' ||
    typeof sidecar.width !== 'number' ||
    typeof sidecar.height !== 'number'
  ) {
    return null;
  }

  const components = componentsFrom(sidecar.components);
  const accessibility = accessibilityFrom(sidecar.accessibility);
  if (sidecar.accessibility !== undefined && accessibility === null) return null;

  return {
    documentDigest: sidecar.documentDigest,
    identity,
    width: sidecar.width,
    height: sidecar.height,
    missingFonts,
    ...(accessibility === null ? {} : { accessibility }),
    ...(components !== undefined ? { components } : {}),
  };
}

/** Verdict-bearing accessibility evidence is either intact or the sidecar is refused. */
function accessibilityFrom(value: unknown): AccessibilitySnapshot | null {
  if (value === undefined) return null;
  const row = recordFrom(value);
  if (
    row === null ||
    row['snapshotVersion'] !== 1 ||
    row['producer'] !== 'playwright-aria@1' ||
    typeof row['engine'] !== 'string' ||
    !Array.isArray(row['roots']) ||
    !row['roots'].every((root) => typeof root === 'string') ||
    typeof row['digest'] !== 'string'
  ) {
    return null;
  }

  const parsed = accessibilitySnapshot(row['engine'], row['roots'] as string[]);
  return parsed.digest === row['digest'] ? parsed : null;
}

/** Optional attribution hashes degrade to area ordering when an old sidecar lacks them. */
function componentsFrom(value: unknown): readonly ComponentHash[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const parsed: ComponentHash[] = [];
  for (const entry of value) {
    const row = recordFrom(entry);
    if (
      row === null ||
      typeof row['component'] !== 'string' ||
      typeof row['instances'] !== 'number' ||
      typeof row['structure'] !== 'string' ||
      typeof row['semantics'] !== 'string' ||
      typeof row['text'] !== 'string' ||
      typeof row['style'] !== 'string'
    ) {
      return undefined;
    }

    parsed.push({
      component: row['component'],
      instances: row['instances'],
      structure: row['structure'],
      semantics: row['semantics'],
      text: row['text'],
      style: row['style'],
      ...(typeof row['geometry'] === 'string' ? { geometry: row['geometry'] } : {}),
    });
  }
  return parsed;
}

/** As {@link sidecarFrom}, for a record that is expected to carry its bytes. */
export function rasterFrom(value: unknown): Raster | null {
  const sidecar = sidecarFrom(value);
  const bytes = recordFrom(value)?.bytes;
  return sidecar === null || typeof bytes !== 'string' ? null : { ...sidecar, bytes };
}

function stringsFrom(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string') ? (value as readonly string[]) : null;
}
