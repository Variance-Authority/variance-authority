import { digestValue } from '@variance-authority/core';

const BACKGROUND = {
  before: '#1f6feb',
  after: '#8250df',
};

/** The one component and one paint-only change shown in the root README. */
export function Button(variant) {
  const button = document.createElement('button');
  button.dataset.component = 'Button';
  button.dataset.props = digestValue({ children: 'Variance' });
  button.textContent = 'Variance';

  Object.assign(button.style, {
    width: '176px',
    height: '56px',
    border: '0',
    borderRadius: '8px',
    backgroundColor: BACKGROUND[variant],
    color: '#ffffff',
    font: '600 17px Arial, sans-serif',
  });

  return button;
}
