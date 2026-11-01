// A module others register into as they load.
const entries = new Map<string, string>();

export const register = (name: string, value: string): void => {
  entries.set(name, value);
};

export const lookup = (name: string): string | undefined => entries.get(name);
