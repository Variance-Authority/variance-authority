export async function fetchUser(id: string): Promise<{ id: string; name: string }> {
  return { id, name: 'Ada' };
}
