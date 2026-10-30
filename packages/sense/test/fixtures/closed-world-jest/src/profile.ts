import ms from 'ms';
import { fetchUser } from './api';

export async function greeting(id: string): Promise<string> {
  const user = await fetchUser(id);
  return `${user.name}, ${ms(60_000)}`;
}
