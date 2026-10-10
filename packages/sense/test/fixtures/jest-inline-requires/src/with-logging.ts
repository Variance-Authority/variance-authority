export function withLogging(fn: (name: string) => string, label: string): (name: string) => string {
  const prefix = `[${label}]`;
  return (name) => `${prefix} ${fn(name)}`;
}
