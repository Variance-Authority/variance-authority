import { decide } from '../src/decide';

it('prints what it decided', () => {
  console.log('decided', decide('alpha'));
  console.warn('warned');
});
