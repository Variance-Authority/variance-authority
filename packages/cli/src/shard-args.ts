/**
 * Read `--shard k/n`: which of `n` machines this one is.
 *
 * Apart from `shard.ts`, which places subjects on shards, because every command
 * parses its arguments and only a run places anything.
 */

export interface Shard {
  /** 1-based, as `--shard 2/4` spells it. */
  readonly index: number;
  readonly total: number;
}

/** `k/n`, or the sentence saying why not. */
export function parseShard(text: string): Shard | string {
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (match === null) return `\`--shard\` takes \`k/n\`, such as \`2/4\`; got \`${text}\``;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || index < 1 || index > total) {
    return `\`--shard ${text}\` names no shard: k must be between 1 and n`;
  }
  return { index, total };
}
