import { useState } from 'react';

/**
 * `Leaves` leaves an interval, a window listener and a global behind, as a
 * story that forgets to clean up does; `Counts` is clicked after it, so React's
 * own listeners have to survive the switch that removes the story's.
 */
export default { title: 'Isolated/Leftover' };

export const Leaves = {
  loaders: [
    () => {
      setInterval(() => {
        document.body.dataset.ticks = String(Number(document.body.dataset.ticks ?? 0) + 1);
      }, 5);
      window.addEventListener('va-ping', () => {
        document.body.dataset.pinged = 'yes';
      });
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
