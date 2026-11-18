// compass: variance-authority.reach.story

/** A test line or hook line as a route says it, among its notes. */
export function cutText(line: number, hook: boolean): string {
  return `${hook ? 'hook' : 'test'} line ${line}`;
}

/** The line a note that {@link cutText} spelled names, and whether it is a hook's; absent for any other note. */
export function cutOf(text: string): { readonly line: number; readonly hook: boolean } | undefined {
  const cut = /^(test|hook) line (\d+)$/.exec(text);
  return cut === null ? undefined : { line: Number(cut[2]), hook: cut[1] === 'hook' };
}
