// compass: variance-authority/runtime/attention
/**
 * Which modules of a before layer were cut from another text than the commit
 * the layer is compared from.
 *
 * A before layer's regions are numbered by the lines of the text they were
 * recorded over, and the diff from the layer's commit is what carries them to
 * the lines they stand on now. That only holds for a module whose text at that
 * commit is the one its regions were cut from. Cut from any other text, a row
 * pairs with whatever region the diff happens to carry it onto, and a case
 * that still calls what it called reads as lost. Those modules are unmeasured,
 * not compared.
 */

import { digestString } from '@variance-authority/core/format';
import { textAtRecording } from '@variance-authority/sense/test-selection';

/**
 * The modules of `modules` whose text at `at` is not the one `texts` says
 * their regions were cut from, in code-unit order. A module `texts` does not
 * name was cut from a text nobody knew, and one `at` does not hold has no
 * lines there to stand on, so both are among them. With no `texts` at all, as
 * in a layer written before it named them, none is: that says nothing either
 * way, and the layer is compared as it always was.
 */
export function cutElsewhere(
  modules: readonly string[],
  texts: Readonly<Record<string, string>> | undefined,
  at: string,
  root: string,
): readonly string[] {
  if (texts === undefined) return [];
  const textAt = textAtRecording(root, modules);
  return modules
    .filter((file) => {
      const cut = texts[file];
      const text = cut === undefined ? undefined : textAt(file, at);
      return text === undefined || digestString(text) !== cut;
    })
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
