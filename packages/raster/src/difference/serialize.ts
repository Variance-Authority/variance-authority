/**
 * The artifact — a manifest and a field, in one self-describing buffer.
 *
 * ```text
 * magic     8 bytes   "VADIFF" 0x00 0x01
 * length    4 bytes   uint32 little-endian, manifest byte length
 * manifest  n bytes   canonical JSON, UTF-8, space-padded to a 4-byte boundary
 * field     m bytes   float32 little-endian, row-major, one value per pixel
 * ```
 *
 * One buffer rather than the directory the specification sketches, because the
 * two halves are only meaningful together: a manifest whose curve was computed
 * from a field it is no longer beside is worse than no manifest, and a directory
 * makes that separation a normal thing to do. The layout is unchanged — anybody
 * who wants `manifest.json` and `field.f32` on disk can split at the offset the
 * header gives them.
 *
 * The field is authoritative. The curve is stored beside it for readers that only
 * want the summary, and is **checked against the field on read** rather than
 * trusted, because a curve and a field that disagree is exactly the corruption a
 * stored derived value invites.
 *
 * Little-endian is written explicitly, not by casting the platform's memory. The
 * whole point of an artifact is that another machine reads it.
 */

import { canonicalize, type CanonicalValue } from '@variance-authority/core/format';
import { differenceCurve } from './curve.js';
import { createField } from './field.js';
import {
  DIFFERENCE_FORMAT_VERSION,
  type DifferenceObservation,
  type NormalizationDescriptor,
} from './observe.js';
import type { MetricDescriptor } from './metric.js';

const MAGIC = new Uint8Array([0x56, 0x41, 0x44, 0x49, 0x46, 0x46, 0x00, 0x01]);
const HEADER_BYTES = MAGIC.length + 4;

export class DifferenceArtifactError extends Error {
  override readonly name = 'DifferenceArtifactError';
}

interface Manifest {
  readonly formatVersion: string;
  readonly metric: MetricDescriptor;
  readonly image: {
    readonly width: number;
    readonly height: number;
    readonly colorSpace: string;
    readonly alphaMode: string;
  };
  readonly normalization: NormalizationDescriptor;
  readonly severityLevels: readonly number[];
  readonly curve: readonly { severity: number; pixelCount: number; imageRatio: number }[];
  readonly sourceHashes: { readonly firstImage: string; readonly secondImage: string };
  readonly field: {
    readonly width: number;
    readonly height: number;
    readonly encoding: 'float32le';
    readonly checksum: string;
  };
}

export function serializeObservation(observation: DifferenceObservation): Uint8Array {
  const { field } = observation;
  const fieldBytes = encodeFieldLittleEndian(field.values);

  const manifest: Manifest = {
    formatVersion: observation.formatVersion,
    metric: observation.metric,
    image: observation.image,
    normalization: observation.normalization,
    severityLevels: observation.curve.map((point) => point.severity),
    curve: observation.curve.map((point) => ({
      severity: point.severity,
      pixelCount: point.pixelCount,
      imageRatio: point.imageRatio,
    })),
    sourceHashes: observation.sourceHashes,
    field: {
      width: field.width,
      height: field.height,
      encoding: 'float32le',
      checksum: `crc32:${crc32(fieldBytes).toString(16).padStart(8, '0')}`,
    },
  };

  const json = canonicalize(JSON.parse(JSON.stringify(manifest)) as CanonicalValue);
  const encoded = new TextEncoder().encode(json);
  // Pad so the field starts 4-byte aligned; trailing whitespace is legal JSON and
  // lets a reader take a typed-array view instead of copying value by value.
  const padding = (4 - ((HEADER_BYTES + encoded.length) % 4)) % 4;
  const manifestBytes = new Uint8Array(encoded.length + padding);
  manifestBytes.set(encoded);
  manifestBytes.fill(0x20, encoded.length);

  const out = new Uint8Array(HEADER_BYTES + manifestBytes.length + fieldBytes.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer, out.byteOffset).setUint32(MAGIC.length, manifestBytes.length, true);
  out.set(manifestBytes, HEADER_BYTES);
  out.set(fieldBytes, HEADER_BYTES + manifestBytes.length);

  return out;
}

export function deserializeObservation(data: Uint8Array): DifferenceObservation {
  if (data.length < HEADER_BYTES) {
    throw new DifferenceArtifactError(`artifact is ${data.length} bytes, shorter than its header`);
  }
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (data[index] !== MAGIC[index]) {
      throw new DifferenceArtifactError('artifact does not start with the difference-format magic');
    }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const manifestLength = view.getUint32(MAGIC.length, true);
  const fieldStart = HEADER_BYTES + manifestLength;
  if (fieldStart > data.length) {
    throw new DifferenceArtifactError(
      `manifest claims ${manifestLength} bytes but the artifact holds ${data.length - HEADER_BYTES}`,
    );
  }

  const manifest = parseManifest(
    new TextDecoder().decode(data.subarray(HEADER_BYTES, fieldStart)),
  );

  const expectedValues = manifest.field.width * manifest.field.height;
  const fieldBytes = data.subarray(fieldStart);
  if (fieldBytes.length !== expectedValues * 4) {
    throw new DifferenceArtifactError(
      `field is ${fieldBytes.length} bytes but ${manifest.field.width}×${manifest.field.height} ` +
        `float32 needs ${expectedValues * 4}`,
    );
  }

  const actual = `crc32:${crc32(fieldBytes).toString(16).padStart(8, '0')}`;
  if (actual !== manifest.field.checksum) {
    throw new DifferenceArtifactError(
      `field checksum is ${actual}, manifest says ${manifest.field.checksum}`,
    );
  }

  const field = createField(
    manifest.field.width,
    manifest.field.height,
    decodeFieldLittleEndian(fieldBytes, expectedValues),
  );

  // The curve is derived, so it is recomputed and checked rather than trusted. A
  // stored summary that no longer matches its own field is silent corruption
  // otherwise: every reader that stops at the manifest gets a wrong answer and
  // nothing tells them.
  const curve = differenceCurve(field, manifest.severityLevels);
  for (let index = 0; index < curve.length; index += 1) {
    const stored = manifest.curve[index];
    const computed = curve[index]!;
    if (stored === undefined || stored.pixelCount !== computed.pixelCount) {
      throw new DifferenceArtifactError(
        `stored curve disagrees with the field at severity ${computed.severity}: manifest says ` +
          `${String(stored?.pixelCount)} pixels, the field has ${computed.pixelCount}`,
      );
    }
  }

  return {
    formatVersion: manifest.formatVersion,
    metric: manifest.metric,
    image: manifest.image,
    normalization: manifest.normalization,
    field,
    curve,
    sourceHashes: manifest.sourceHashes,
  };
}

function parseManifest(json: string): Manifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new DifferenceArtifactError(`manifest is not valid JSON: ${String(cause)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new DifferenceArtifactError('manifest is not an object');
  }

  const manifest = parsed as Manifest;
  if (manifest.formatVersion !== DIFFERENCE_FORMAT_VERSION) {
    throw new DifferenceArtifactError(
      `artifact declares format ${String(manifest.formatVersion)}; this build reads ` +
        `${DIFFERENCE_FORMAT_VERSION}`,
    );
  }
  if (manifest.field?.encoding !== 'float32le') {
    throw new DifferenceArtifactError(
      `field encoding is ${String(manifest.field?.encoding)}, expected float32le`,
    );
  }
  return manifest;
}

function encodeFieldLittleEndian(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * 4, values[index]!, true);
  }
  return bytes;
}

function decodeFieldLittleEndian(bytes: Uint8Array, count: number): Float32Array {
  const values = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < count; index += 1) {
    values[index] = view.getFloat32(index * 4, true);
  }
  return values;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3), the same polynomial PNG itself uses. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
