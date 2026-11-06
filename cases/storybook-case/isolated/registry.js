const entries = new Map();

/** Adds `name` to this session's registry. */
export const register = (name) => entries.set(name, true);

/** How many names this session's registry holds. */
export const registered = () => entries.size;
