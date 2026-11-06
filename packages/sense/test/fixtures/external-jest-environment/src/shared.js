export function read(value) {
  if (value === 'environment') return 'host';
  return 'test';
}
