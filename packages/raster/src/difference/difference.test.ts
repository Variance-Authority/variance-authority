import { describe, expect, it } from 'vitest';
import {
  CHANNEL_DISTANCE,
  DifferenceArtifactError,
  DifferenceFieldError,
  IncomparableObservationsError,
  YIQ_DISTANCE,
  areComparable,
  comparabilityReasons,
  compareDifferenceObservations,
  createField,
  deserializeObservation,
  differenceCurve,
  fieldStatistics,
  measureYiqDistance,
  normalizeSeverityLevels,
  observeDifference,
  serializeObservation,
  severityBetweenColors,
  yiqSeverityForThreshold,
  yiqThresholdForSeverity,
  type DifferenceObservation,
  type NormalizedImage,
} from './index.js';

const LEVELS = [0, 0.01, 0.04, 0.16, 0.64];

function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
  alphaMode: NormalizedImage['alphaMode'] = 'opaque',
): NormalizedImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const at = (y * width + x) * 4;
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = a;
    }
  }
  return { width, height, data, colorSpace: 'srgb', alphaMode };
}

const flat = (r: number, g: number, b: number) => image(4, 4, () => [r, g, b, 255]);

async function observe(
  first: NormalizedImage,
  second: NormalizedImage,
  severityLevels: readonly number[] = LEVELS,
): Promise<DifferenceObservation> {
  return observeDifference({ firstImage: first, secondImage: second, metric: YIQ_DISTANCE, severityLevels });
}

describe('createField', () => {
  it('rejects a non-finite value, because NaN >= t is false at every level', () => {
    // The failure this prevents: NaN is absent from every curve point, so an
    // all-NaN field produces the same curve as two identical images.
    const values = Float32Array.from([0, Number.NaN, 0, 0]);
    expect(() => createField(2, 2, values)).toThrow(DifferenceFieldError);
    expect(() => createField(2, 2, values)).toThrow(/non-finite difference/);

    expect(differenceCurve({ width: 2, height: 2, values }, [0, 0.5])).toEqual([
      { severity: 0, pixelCount: 3, imageRatio: 0.75 },
      { severity: 0.5, pixelCount: 0, imageRatio: 0 },
    ]);
  });

  it('rejects a negative value and a wrong length', () => {
    expect(() => createField(2, 2, Float32Array.from([0, -1, 0, 0]))).toThrow(/cannot be negative/);
    expect(() => createField(2, 2, Float32Array.from([0, 0]))).toThrow(/needs 4/);
  });
});

describe('differenceCurve', () => {
  const field = createField(2, 2, Float32Array.from([0, 0.1, 0.5, 0.9]));

  it('counts pixels at or above each severity', () => {
    expect(differenceCurve(field, [0, 0.2, 0.6])).toEqual([
      { severity: 0, pixelCount: 4, imageRatio: 1 },
      { severity: 0.2, pixelCount: 2, imageRatio: 0.5 },
      { severity: 0.6, pixelCount: 1, imageRatio: 0.25 },
    ]);
  });

  it('is 1.0 at severity 0 even for two identical images', () => {
    // Not a bug: every pixel differs by at least zero. It is why
    // fieldStatistics().changedPixels exists.
    const identical = createField(2, 2, new Float32Array(4));
    expect(differenceCurve(identical, [0])[0]?.imageRatio).toBe(1);
    expect(fieldStatistics(identical).changedPixels).toBe(0);
    expect(fieldStatistics(field).changedPixels).toBe(3);
  });

  it('sorts and de-duplicates the levels it was given', () => {
    expect(normalizeSeverityLevels([0.6, 0, 0.2, 0.6])).toEqual([0, 0.2, 0.6]);
    expect(differenceCurve(field, [0.6, 0.2]).map((point) => point.severity)).toEqual([0.2, 0.6]);
  });

  it('is monotonically non-increasing over many levels', () => {
    const values = new Float32Array(1000);
    for (let index = 0; index < values.length; index += 1) values[index] = (index % 97) / 97;
    const curve = differenceCurve(createField(100, 10, values), [
      0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 0.9, 1,
    ]);
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index]!.pixelCount).toBeLessThanOrEqual(curve[index - 1]!.pixelCount);
    }
    expect(curve.at(-1)!.pixelCount).toBe(0);
  });

  it('rejects a negative or non-finite level', () => {
    expect(() => normalizeSeverityLevels([-1])).toThrow(DifferenceFieldError);
    expect(() => normalizeSeverityLevels([Number.NaN])).toThrow(DifferenceFieldError);
  });
});

describe('YIQ_DISTANCE', () => {
  it('converts between severity and a pixelmatch threshold', () => {
    expect(yiqSeverityForThreshold(0.1)).toBeCloseTo(0.01, 12);
    expect(yiqThresholdForSeverity(0.01)).toBeCloseTo(0.1, 12);
  });

  it('predicts a recolour severity from the two colours alone, before rendering', () => {
    // The token values are enough: --va-color-accent moving #2d6cdf -> #b5179e
    // is worth 0.153, and the field agrees pixel for pixel.
    expect(severityBetweenColors([0x2d, 0x6c, 0xdf], [0xb5, 0x17, 0x9e])).toBeCloseTo(0.15282, 5);
    expect(severityBetweenColors([1, 2, 3], [1, 2, 3])).toBe(0);

    const predicted = severityBetweenColors([0x2d, 0x6c, 0xdf], [0xb5, 0x17, 0x9e]);
    const observed = measureYiqDistance(flat(0x2d, 0x6c, 0xdf), flat(0xb5, 0x17, 0x9e));
    for (const value of observed.values) expect(value).toBeCloseTo(predicted, 6);
  });

  it('puts the todomvc accent rebrand at the distance the token values predict', () => {
    // --va-color-accent: #2d6cdf -> #b5179e, computed by hand from the YIQ
    // coefficients. A recolour is one value everywhere it lands, which is the
    // property the whole "known difference" idea leans on.
    const field = measureYiqDistance(flat(0x2d, 0x6c, 0xdf), flat(0xb5, 0x17, 0x9e));
    for (const value of field.values) expect(value).toBeCloseTo(0.15282, 4);
  });

  it('is zero for identical images and symmetric in its arguments', () => {
    const a = flat(10, 200, 30);
    const b = flat(90, 40, 210);
    expect([...measureYiqDistance(a, a).values]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const forward = measureYiqDistance(a, b).values;
    const backward = measureYiqDistance(b, a).values;
    for (let index = 0; index < forward.length; index += 1) {
      expect(forward[index]).toBeCloseTo(backward[index]!, 12);
    }
  });

  it('reaches its maximum at red against cyan, not at black against white', () => {
    // Worth pinning: the obvious reading of "normalised to [0,1]" is that black
    // against white is 1.0, and it is not — it is 0.933. The maximum of the YIQ
    // form is at the chroma extreme, so a greyscale subject can never produce a
    // severity above 0.934 however wrong it is.
    for (const value of measureYiqDistance(flat(0, 0, 0), flat(255, 255, 255)).values) {
      expect(value).toBeCloseTo(0.93304, 4);
    }
    for (const value of measureYiqDistance(flat(255, 0, 0), flat(0, 255, 255)).values) {
      expect(value).toBeCloseTo(1, 4);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('CHANNEL_DISTANCE', () => {
  it('weights every channel the same, which no eye does', async () => {
    const observation = await observeDifference({
      firstImage: flat(0, 0, 0),
      secondImage: flat(0, 0, 255),
      metric: CHANNEL_DISTANCE,
      severityLevels: [0.5],
    });
    expect(observation.field.values[0]).toBeCloseTo(1, 12);
    // The same change in blue is nearly invisible on the perceptual metric.
    expect(measureYiqDistance(flat(0, 0, 0), flat(0, 0, 255)).values[0]).toBeLessThan(0.3);
  });
});

describe('observeDifference', () => {
  it('refuses images of different sizes rather than padding them', async () => {
    await expect(observe(flat(0, 0, 0), image(4, 5, () => [0, 0, 0, 255]))).rejects.toThrow(
      /does not resize, pad or align/,
    );
  });

  it('refuses images that declare different colour spaces or alpha modes', async () => {
    const a = flat(0, 0, 0);
    await expect(observe(a, { ...a, colorSpace: 'display-p3' })).rejects.toThrow(/colour spaces/);
    await expect(observe(a, { ...a, alphaMode: 'straight' })).rejects.toThrow(/alpha modes/);
  });

  it('records the metric descriptor, the unit and the levels it ran at', async () => {
    const observation = await observe(flat(0, 0, 0), flat(255, 255, 255));
    expect(observation.metric.name).toBe('yiq-distance');
    expect(observation.metric.unit).toBe('yiq-normalized');
    expect(observation.formatVersion).toBe('variance-difference/1');
    expect(observation.curve.map((point) => point.severity)).toEqual(LEVELS);
    expect(observation.image).toEqual({ width: 4, height: 4, colorSpace: 'srgb', alphaMode: 'opaque' });
  });

  it('hashes the two sources differently and reproducibly', async () => {
    const one = await observe(flat(0, 0, 0), flat(255, 255, 255));
    const two = await observe(flat(0, 0, 0), flat(255, 255, 255));
    expect(one.sourceHashes.firstImage).not.toBe(one.sourceHashes.secondImage);
    expect(one.sourceHashes).toEqual(two.sourceHashes);
  });

  it('rejects a metric that returns a field of the wrong size', async () => {
    await expect(
      observeDifference({
        firstImage: flat(0, 0, 0),
        secondImage: flat(1, 1, 1),
        severityLevels: [0],
        metric: {
          ...YIQ_DISTANCE,
          measure: async () => createField(2, 2, new Float32Array(4)),
        },
      }),
    ).rejects.toThrow(/returned a 2×2 field for 4×4 images/);
  });

  it('flattens straight alpha onto a declared background when asked, and only then', async () => {
    const translucent = image(4, 4, () => [255, 0, 0, 128], 'straight');
    const opaqueRed = image(4, 4, () => [255, 0, 0, 255], 'straight');

    const asIs = await observeDifference({
      firstImage: translucent,
      secondImage: opaqueRed,
      metric: YIQ_DISTANCE,
      severityLevels: [0],
    });
    const flattened = await observeDifference({
      firstImage: translucent,
      secondImage: opaqueRed,
      metric: YIQ_DISTANCE,
      severityLevels: [0],
      normalization: { flattenOnto: { red: 255, green: 255, blue: 255 } },
    });

    expect(asIs.normalization.parameters).toEqual({ flattenOnto: 'none' });
    expect(flattened.normalization.parameters).toEqual({ flattenOnto: 'rgb(255,255,255)' });
    expect(flattened.image.alphaMode).toBe('opaque');
    expect(fieldStatistics(flattened.field).changedPixels).toBe(16);
  });
});

describe('compareDifferenceObservations', () => {
  it('reports how the difference moved at each severity', async () => {
    const baseline = await observe(flat(0, 0, 0), flat(20, 20, 20));
    const current = await observe(flat(0, 0, 0), flat(255, 255, 255));
    const comparison = compareDifferenceObservations(baseline, current);

    const at64 = comparison.curveDelta.find((point) => point.severity === 0.64);
    expect(at64?.baselineImageRatio).toBe(0);
    expect(at64?.currentImageRatio).toBe(1);
    expect(at64?.imageRatioDelta).toBe(1);
    expect(at64?.pixelCountDelta).toBe(16);
  });

  it('splits the field delta into increase and decrease', async () => {
    const baseline = await observe(flat(0, 0, 0), flat(255, 255, 255));
    const current = await observe(flat(0, 0, 0), flat(0, 0, 0));
    const { fieldDelta, summary } = compareDifferenceObservations(baseline, current);

    expect([...fieldDelta.signed.values].every((value) => value < 0)).toBe(true);
    expect([...fieldDelta.increase.values].every((value) => value === 0)).toBe(true);
    expect([...fieldDelta.decrease.values].every((value) => value > 0)).toBe(true);
    expect(summary.totalIncrease).toBe(0);
    // 16 pixels that each fell from black-against-white (0.933) to zero.
    expect(summary.totalDecrease).toBeCloseTo(16 * 0.93304, 3);
    expect(summary.maximumDelta).toBeLessThan(0);
  });

  it('has no status field anywhere in the result', async () => {
    const baseline = await observe(flat(0, 0, 0), flat(255, 255, 255));
    const comparison = compareDifferenceObservations(baseline, baseline);
    const json = JSON.stringify(comparison, (_key, value: unknown) =>
      value instanceof Float32Array ? [] : value,
    );
    for (const word of ['status', 'verdict', 'passed', 'failed', 'acceptable']) {
      expect(json).not.toContain(word);
    }
  });

  it('refuses every way two observations can mean different things', async () => {
    const baseline = await observe(flat(0, 0, 0), flat(255, 255, 255));

    const cases: readonly [string, DifferenceObservation][] = [
      ['format version', { ...baseline, formatVersion: 'variance-difference/2' }],
      ['metric name', { ...baseline, metric: { ...baseline.metric, name: 'flip' } }],
      ['metric version', { ...baseline, metric: { ...baseline.metric, version: '2' } }],
      ['metric unit', { ...baseline, metric: { ...baseline.metric, unit: 'jnd' } }],
      [
        'metric parameters',
        { ...baseline, metric: { ...baseline.metric, parameters: { alphaBackground: 'black' } } },
      ],
      ['normalization version', { ...baseline, normalization: { version: '2', parameters: {} } }],
      [
        'normalization parameters',
        { ...baseline, normalization: { ...baseline.normalization, parameters: { flattenOnto: 'rgb(0,0,0)' } } },
      ],
      ['colour space', { ...baseline, image: { ...baseline.image, colorSpace: 'display-p3' } }],
      ['alpha mode', { ...baseline, image: { ...baseline.image, alphaMode: 'straight' } }],
      ['image dimensions', { ...baseline, image: { ...baseline.image, width: 8 } }],
      ['severity levels', { ...baseline, curve: baseline.curve.slice(1) }],
    ];

    for (const [what, current] of cases) {
      expect(areComparable(baseline, current), what).toBe(false);
      expect(comparabilityReasons(baseline, current).join(' '), what).toContain(what);
      expect(() => compareDifferenceObservations(baseline, current), what).toThrow(
        IncomparableObservationsError,
      );
    }

    expect(areComparable(baseline, baseline)).toBe(true);
  });

  it('reports every reason at once rather than the first', async () => {
    const baseline = await observe(flat(0, 0, 0), flat(255, 255, 255));
    const current: DifferenceObservation = {
      ...baseline,
      formatVersion: 'other',
      metric: { ...baseline.metric, name: 'flip', version: '9' },
    };
    expect(comparabilityReasons(baseline, current)).toHaveLength(3);
  });
});

describe('serializeObservation', () => {
  it('round-trips through bytes', async () => {
    const original = await observe(flat(12, 34, 56), flat(200, 100, 50));
    const restored = deserializeObservation(serializeObservation(original));

    expect(restored.formatVersion).toBe(original.formatVersion);
    expect(restored.metric).toEqual(original.metric);
    expect(restored.image).toEqual(original.image);
    expect(restored.normalization).toEqual(original.normalization);
    expect(restored.sourceHashes).toEqual(original.sourceHashes);
    expect(restored.curve).toEqual(original.curve);
    expect([...restored.field.values]).toEqual([...original.field.values]);
    expect(areComparable(original, restored)).toBe(true);
  });

  it('is byte-identical for the same observation serialized twice', async () => {
    const observation = await observe(flat(12, 34, 56), flat(200, 100, 50));
    expect([...serializeObservation(observation)]).toEqual([...serializeObservation(observation)]);
  });

  it('starts the field on a 4-byte boundary', async () => {
    const bytes = serializeObservation(await observe(flat(1, 2, 3), flat(4, 5, 6)));
    const manifestLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
    expect((12 + manifestLength) % 4).toBe(0);
  });

  it('detects a tampered field', async () => {
    const bytes = serializeObservation(await observe(flat(1, 2, 3), flat(4, 5, 6)));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    expect(() => deserializeObservation(bytes)).toThrow(/checksum/);
  });

  it('detects a manifest whose curve no longer matches its field', async () => {
    const observation = await observe(flat(0, 0, 0), flat(255, 255, 255));
    const bytes = serializeObservation(observation);
    const manifestLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
    const json = new TextDecoder().decode(bytes.subarray(12, 12 + manifestLength));

    // Same length, so the header still parses: the curve claims one fewer pixel.
    const lie = json.replace('"pixelCount":16', '"pixelCount":15');
    expect(lie).not.toBe(json);
    const patched = new Uint8Array(bytes);
    patched.set(new TextEncoder().encode(lie.padEnd(manifestLength, ' ')), 12);

    expect(() => deserializeObservation(patched)).toThrow(DifferenceArtifactError);
    expect(() => deserializeObservation(patched)).toThrow(/stored curve disagrees with the field/);
  });

  it('refuses a buffer that is not one of these', () => {
    expect(() => deserializeObservation(new Uint8Array(4))).toThrow(/shorter than its header/);
    expect(() => deserializeObservation(new Uint8Array(64))).toThrow(/magic/);
  });

  it('refuses an artifact from a future format version', async () => {
    const observation = await observe(flat(0, 0, 0), flat(1, 1, 1));
    const bytes = serializeObservation(observation);
    const manifestLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
    const json = new TextDecoder().decode(bytes.subarray(12, 12 + manifestLength));
    const patched = new Uint8Array(bytes);
    patched.set(
      new TextEncoder().encode(
        json.replace('variance-difference/1', 'variance-difference/9').padEnd(manifestLength, ' '),
      ),
      12,
    );
    expect(() => deserializeObservation(patched)).toThrow(/this build reads/);
  });
});

describe('the second-order measurement', () => {
  it('tracks a known difference that never was zero', async () => {
    // Two renderers that disagree by construction: B paints the accent one step
    // off. The baseline difference is real and accepted; what is watched is
    // whether it grows.
    const chromiumish = flat(0x2d, 0x6c, 0xdf);
    const webkitish = flat(0x2d, 0x6c, 0xdd);
    const baseline = await observe(chromiumish, webkitish);
    expect(fieldStatistics(baseline.field).changedPixels).toBe(16);

    // Later: the same pair, still disagreeing, by the same amount.
    const unchanged = await observe(chromiumish, webkitish);
    const quiet = compareDifferenceObservations(baseline, unchanged);
    expect(quiet.summary.totalIncrease).toBe(0);
    expect(quiet.summary.totalDecrease).toBe(0);
    expect(quiet.curveDelta.every((point) => point.imageRatioDelta === 0)).toBe(true);

    // Later still: the disagreement widened.
    const widened = await observe(chromiumish, flat(0xb5, 0x17, 0x9e));
    const loud = compareDifferenceObservations(baseline, widened);
    expect(loud.summary.totalIncrease).toBeGreaterThan(0);
    expect(loud.curveDelta.find((point) => point.severity === 0.04)?.imageRatioDelta).toBe(1);
  });
});
