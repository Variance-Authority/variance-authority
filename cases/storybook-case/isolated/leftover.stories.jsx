import { useState } from 'react';

/**
 * `Leaves` leaves an interval and a global behind, as a story that forgets to
 * clean up does; `Counts` is clicked after it, so the switch that ends them
 * has to leave the page working.
 */
export default { title: 'Isolated/Leftover' };

export const Leaves = {
  loaders: [
    () => {
      setInterval(() => {
        document.body.dataset.ticks = String(Number(document.body.dataset.ticks ?? 0) + 1);
      }, 5);
      globalThis.leftover = 'left';
      return {};
    },
  ],
  render: () => <output>left</output>,
};

const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      <output>{count}</output>
    </button>
  );
};

export const Counts = { render: () => <Counter /> };
