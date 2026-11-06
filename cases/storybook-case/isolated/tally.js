let count = 0;

/** One more than the last call in this session. */
export const tally = () => ++count;

/** The count this session holds, without adding to it. */
export const peek = () => count;
