import {
  accessibilitySnapshot,
  type AccessibilitySnapshot,
  type ComponentHash,
  type Raster,
  type Rect,
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

  // Dropped when it will not parse, never refused. It decides a sentence — did
  // this defect arrive with the change under review — and the fallback of an
  // unreadable list is the sentence that says nothing was recorded, which is
  // what every baseline written before this field said anyway.
  const findingMarks = stringsFrom(sidecar.findingMarks);
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
    ...(findingMarks === null ? {} : { findingMarks }),
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

    const boxes = boxesFrom(row['boxes'], row['instances']);

    parsed.push({
      component: row['component'],
      instances: row['instances'],
      structure: row['structure'],
      semantics: row['semantics'],
      text: row['text'],
      style: row['style'],
      ...(typeof row['geometry'] === 'string' ? { geometry: row['geometry'] } : {}),
      ...(boxes === null ? {} : { boxes }),
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

/**
 * The per-instance boxes, or nothing — dropped when they will not parse.
 *
 * `null` rather than a refusal, for {@link sidecarFrom}'s reason about finding
 * marks: these decide a sentence, not a verdict. Every baseline written before
 * they existed carries none, and a sidecar refused over them would make a
 * comparison that used to work fail on the field that was added to explain it.
 *
 * The length is checked against the instance count because the list is read
 * positionally. A short list paired by index compares one instance against a
 * different one and reports a size change nobody made.
 */
function boxesFrom(value: unknown, instances: number): readonly (Rect | null)[] | null {
  if (!Array.isArray(value) || value.length !== instances) return null;

  const parsed: (Rect | null)[] = [];
  for (const entry of value) {
    if (entry === null) {
      parsed.push(null);
      continue;
    }
    const row = recordFrom(entry);
    if (
      row === null ||
      typeof row['x'] !== 'number' ||
      typeof row['y'] !== 'number' ||
      typeof row['width'] !== 'number' ||
      typeof row['height'] !== 'number'
    ) {
      return null;
    }
    parsed.push({ x: row['x'], y: row['y'], width: row['width'], height: row['height'] });
  }
  return parsed;
}

function stringsFrom(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string') ? (value as readonly string[]) : null;
}
