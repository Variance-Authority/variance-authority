import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Remover } from '../src/remover.js';
import './watched.js';

let attempts = 0;
it('passes on its second attempt', { retry: 1 }, () => {
  attempts += 1;
  render(createElement(Remover));
  if (attempts === 1) throw new Error('the first attempt fails before it clicks');
  fireEvent.click(screen.getByRole('button', { name: 'Remove me' }));
});
