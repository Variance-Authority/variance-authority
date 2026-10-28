import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Remover } from '../src/remover.js';
import './watched.js';

it('removes itself when clicked', () => {
  render(createElement(Remover));
  fireEvent.click(screen.getByRole('button', { name: 'Remove me' }));
  expect(screen.getByText('Removed')).toBeTruthy();
});
