import { createContext, useContext } from 'react';

/**
 * Whether the person looking may only read.
 *
 * An opened deployment shows its evidence to somebody it has not named, and that
 * person has no name to decide with. The server refuses the write either way;
 * this is the surface not offering a button whose only answer is a refusal.
 */
export const Reading = createContext(false);

export function useReading(): boolean {
  return useContext(Reading);
}
