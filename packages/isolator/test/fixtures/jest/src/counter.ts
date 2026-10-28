let count = 0;
const seen = new Set<number>();

export const next = (): number => {
  count += 1;
  seen.add(count);
  return count;
};

export const size = (): number => seen.size;
