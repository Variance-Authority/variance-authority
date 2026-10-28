export async function add(left: number, right: number): Promise<number> {
  await new Promise((wake) => setTimeout(wake, 5));
  if (right === 1) {
    return left + 1;
  }
  await new Promise((wake) => setTimeout(wake, 5));
  return left + right;
}
