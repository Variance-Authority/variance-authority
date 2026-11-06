import { useState } from 'react';

/** Says nothing it was given, so it renders only because its parent did. */
export function Badge() {
  return <i>cart</i>;
}

/** Renders whatever its parent decided. */
export function Summary({ expanded }: { expanded: boolean }) {
  return <p>{expanded ? 'open' : 'closed'}</p>;
}

/** Holds the decision, and changes it on a click. */
export function Cart() {
  const [expanded, setExpanded] = useState(false);
  return (
    <button type="button" onClick={() => setExpanded(true)}>
      <Badge />
      <Summary expanded={expanded} />
    </button>
  );
}
