export function total(items: readonly number[]): number {
  if (items.length === 0) {
    return 0;
  }
  return items.reduce((sum, item) => sum + item, 0);
}
