export function fallback(error: unknown): string {
  return `failed: ${String(error)}`;
}
