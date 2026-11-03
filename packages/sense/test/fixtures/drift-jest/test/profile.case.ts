import { greeting } from '../src/profile';

jest.mock('../src/api');

it('greets through the mock beside the module and the mock of the package', async () => {
  expect(await greeting('1')).toBe('Ada, 60000ms');
});
