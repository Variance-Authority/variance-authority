import { decodeCase, decodeReadings, encodeReadings, type StoredReading } from '../readings-bytes.js';

/** A readings section as plain values: each case's stored readings, and each test file's inputs. */
export interface ReadingsShape {
  readonly cases?: Readonly<Record<string, readonly StoredReading[]>>;
  readonly inputs?: Readonly<Record<string, string>>;
}

/** The section `shape` names, as `layReadings` writes it. */
export function sectionOf(shape: ReadingsShape): Buffer {
  return encodeReadings(Object.entries(shape.cases ?? {}), Object.entries(shape.inputs ?? {}));
}

/** The section's bytes as plain values, a part it holds none of left out. */
export function shapeOf(section: Uint8Array): ReadingsShape {
  const { cases, inputs } = decodeReadings(section);
  return {
    ...(cases.size === 0 ? {} : { cases: Object.fromEntries([...cases].map(([id, bytes]) => [id, decodeCase(bytes)])) }),
    ...(inputs.size === 0 ? {} : { inputs: Object.fromEntries(inputs) }),
  };
}
