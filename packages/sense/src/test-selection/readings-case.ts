/**
 * One case's bytes of the `cases.readings` section, as `readings-bytes.ts`
 * names them, read in plain JavaScript: the page `variance view` writes reads a
 * record with it. The fold that decides what a reading means is the addon's.
 */
import { ADDED, GONE, invalid, REGIONS, refused, STOPPED, STOPS, VALUES, type ReadRegion, type StoredReading } from './readings-bytes.js';
import { varints } from './varints.js';

const text = new TextDecoder();

/** One case's stored readings off its bytes, newest first. */
export function decodeCase(bytes: Uint8Array): StoredReading[] {
  const read = varints(bytes, refused);
  const strings: string[] = [];
  for (let count = read.take(); strings.length < count;) strings.push(text.decode(read.bytes(read.take())));
  const string = (): string => strings[read.take()] ?? invalid();
  const value = (): number | null => {
    const held = read.take();
    return held === 0 ? null : held - 1;
  };
  const region = (): ReadRegion => [string(), string(), string(), read.take(), read.take(), value()];
  // Every item takes a byte at least, so a count past what is left is refused before room is made for it.
  const list = <T>(each: () => T): T[] => {
    const count = read.take();
    return count > read.left ? invalid() : Array.from({ length: count }, each);
  };
  const readings: StoredReading[] = [];
  for (let count = read.take(); readings.length < count;) {
    const reading: { -readonly [K in keyof StoredReading]: StoredReading[K] } = { count: read.take() };
    const flags = read.take();
    if (flags & STOPPED) reading.stopped = (flags & STOPS) !== 0;
    if (flags & REGIONS) reading.regions = list(region);
    if (flags & GONE) {
      let at = -1;
      reading.gone = list(() => (at += read.take() + 1));
    }
    if (flags & VALUES) reading.values = list(() => [read.take(), value()] as const);
    if (flags & ADDED) reading.added = list(() => [read.take(), region()] as const);
    readings.push(reading);
  }
  if (!read.done) invalid();
  return readings;
}
