export async function fetchUser(id: string): Promise<{ id: string; name: string }> {
  const response = await fetch(`https://example.invalid/users/${id}`);
  return response.json() as Promise<{ id: string; name: string }>;
}
