import { createElement, useState } from 'react';

/** A button that removes itself once clicked, leaving a line in its place. */
export function Remover() {
  const [removed, setRemoved] = useState(false);
  if (removed) return createElement('p', null, 'Removed');
  return createElement('button', { type: 'button', onClick: () => setRemoved(true) }, 'Remove me');
}
