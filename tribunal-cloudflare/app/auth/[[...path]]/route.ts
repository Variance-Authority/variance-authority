import { mounted } from '../../routes';

/**
 * Sign-in at the root of the host.
 *
 * GitHub returns a person to the callback the App was registered with, and that
 * address is the same for every deployment: `/auth/github/callback`, unmounted.
 */
export const { GET, POST, PUT, HEAD } = mounted('');
