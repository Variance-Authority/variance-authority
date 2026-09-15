// The import that a spy stands in front of. The module is loaded either way;
// `formatTotal` runs only when nothing has replaced it.
export function formatTotal(cents: number): string {
  const whole = Math.floor(cents / 100);
  return `$${whole}.${String(cents % 100).padStart(2, '0')}`;
}
