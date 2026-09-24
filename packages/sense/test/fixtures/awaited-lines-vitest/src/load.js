export async function load(fetcher) {
  const value = await fetcher(
    'key',
  );
  return value;
}

export async function loadAll(first, second) {
  const values = await Promise.all([
    first(),
    second(),
  ]);
  return values;
}

export async function loadChain(fetcher) {
  const value = await fetcher('key')
    .then((found) => found.toUpperCase());
  return value;
}
