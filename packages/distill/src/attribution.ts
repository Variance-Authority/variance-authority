// compass: variance-authority/runtime/attention
import { isAbsolute, relative, sep } from 'node:path';

/**
 * Bringing two producers' file paths to one shape, or declining to.
 *
 * Eyes names a component's source the way the bundler handed it over, which is
 * an absolute path in every normal run. Sense names an entered module through
 * `projectPath`, which is project-relative by construction. Comparing the two
 * with `Set.has` is a join on a value neither side carries, and it does not
 * merely miss — it reports every entered file as an opportunity, including the
 * addressed component itself, and the reading looks plausible.
 *
 * So the shapes are reconciled explicitly, against a root the caller supplies,
 * and where they cannot be the comparison is withheld rather than guessed. Two
 * things are refused on purpose: suffix matching, which would join `src/a.tsx`
 * to any path ending that way and quietly pick a winner among several; and a
 * default of "assume they agree", which is the present defect written down.
 */
export type Attribution =
  | {
      readonly joined: true;
      /** Addressed source files, in the shape the comparison uses. */
      readonly addressed: ReadonlySet<string>;
      /** Addressed files that matched no entered module, sorted. */
      readonly notEntered: readonly string[];
      /** The same shaping, for one entered file. */
      readonly key: (file: string) => string;
    }
  | { readonly joined: false; readonly because: string };

type Shape = 'absolute' | 'project-relative' | 'mixed' | 'empty';

/** Reconcile entered and addressed paths, or say what stopped the comparison. */
export function attribute(
  root: string | undefined,
  entered: readonly string[],
  addressed: ReadonlySet<string>,
): Attribution {
  if (root === undefined) {
    const declined = disagreement(shapeOf(entered), shapeOf(addressed));
    if (declined !== undefined) return { joined: false, because: declined };
  }
  const key = (file: string): string => shaped(root, file);
  const wanted = new Set([...addressed].map(key));
  const reached = new Set(entered.map(key));
  const notEntered = [...wanted].filter((file) => !reached.has(file)).sort();
  if (wanted.size > 0 && reached.size > 0 && notEntered.length === wanted.size) {
    return {
      joined: false,
      because:
        `none of the ${wanted.size} addressed source file(s) matched any of the ` +
        `${reached.size} entered module(s)` +
        (root === undefined
          ? ', and no root was supplied to rule out a difference in path shape.'
          : ` under root ${root}.`) +
        ' The two sides may be rooted differently; an opportunity list built on ' +
        'that would name every entered file, so none is offered. Supply the ' +
        'project root the runner recorded against.',
    };
  }
  return { joined: true, addressed: wanted, notEntered, key };
}

function disagreement(entered: Shape, addressed: Shape): string | undefined {
  if (entered === 'mixed' || addressed === 'mixed') {
    return (
      'the supplied paths mix absolute and project-relative forms and no root ' +
      'was supplied to bring them to one shape.'
    );
  }
  if (entered === 'empty' || addressed === 'empty' || entered === addressed) return undefined;
  return (
    `the entered modules are named by ${entered} path and the addressed source ` +
    `by ${addressed} path, and no root was supplied to bring them to one shape. ` +
    'Comparing them as written would report every entered file as an opportunity.'
  );
}

function shapeOf(files: Iterable<string>): Shape {
  let absolute = false;
  let relative = false;
  for (const file of files) {
    if (isAbsolute(file)) absolute = true;
    else relative = true;
  }
  if (absolute && relative) return 'mixed';
  if (absolute) return 'absolute';
  return relative ? 'project-relative' : 'empty';
}

function shaped(root: string | undefined, file: string): string {
  const path = root === undefined || !isAbsolute(file) ? file : relative(root, file);
  return path.split(sep).join('/');
}
