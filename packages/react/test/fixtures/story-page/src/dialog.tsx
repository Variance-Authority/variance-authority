import { useState } from 'react';

export function Dialog() {
  return (
    <div role="dialog" aria-label="Confirm order">
      <button type="button">Yes</button>
    </div>
  );
}

export function App() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open ? <Dialog /> : null}
    </main>
  );
}
