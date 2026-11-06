// State a hook seeds for the tests after it: a fresh file keeps what its
// `beforeAll` hooks wrote for every test they enclose.
let cache = 'empty';

export const seed = (value: string): void => {
  cache = value;
};

export const extend = (suffix: string): void => {
  cache += suffix;
};

export const read = (): string => cache;
