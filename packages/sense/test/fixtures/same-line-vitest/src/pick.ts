export function pick(items: readonly string[], wanted: string): string | undefined {
  return items.find((one) => one === wanted) ?? items.find((one) => one.startsWith(wanted));
}
