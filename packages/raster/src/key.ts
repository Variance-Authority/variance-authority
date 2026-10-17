// compass: variance-authority.retention

/**
 * Which baseline a store is asked for, and what a file-backed store names it by.
 *
 * `subject` and `label` decide which baseline it is, and so does `project` when
 * the template places by `{project}`: two projects are then two baselines of
 * one subject. The rest decide only where a store that writes files puts it
 * (`baselines.path`).
 */
export interface BaselineKey {
  readonly subject: string;
  /** Distinguishes several images of one subject, e.g. a viewport or a state. */
  readonly label?: string;

  /**
   * The file that declares this subject, relative to the repository, in posix
   * spelling: `src/ui/Button.stories.tsx`, a Playwright spec, a test file.
   *
   * A subject id is a namespaced identifier and is not a path: a story is
   * `story:components-button--primary`, and the file declaring it is known to
   * the artifact that produced the plan and to nothing downstream. Carried here
   * so a store can place the image beside the code it is an image of, and
   * name it after that code, without making the id path-shaped.
   *
   * Absent when no file declares the subject. Only placement reads this, `title`
   * and `name`: two placements of one subject are one subject, which is what [ADR-0016](https://github.com/Variance-Authority/variance-authority/blob/main/docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)
   * says about every other storage decision.
   */
  readonly file?: string;

  /**
   * Where the subject sits in its file's own hierarchy, `/`-separated: a
   * story's title (`Components/Button`), a test's describe chain. Absent when
   * the collector knows none, and a store then reads it from the id.
   */
  readonly title?: string;

  /** The subject's own name under its title: a story's name, a test's title. */
  readonly name?: string;

  /**
   * The runner's project that observed it: a Playwright project's `name`.
   *
   * One test run by two projects is one subject twice, and two projects that
   * differ only in what the identity does not hold — a colour scheme, a
   * viewport — paint two images of it. Carried so `{project}` can file them
   * apart, and so a store can tell a second project from a second machine.
   * Under `{project}` it decides which baseline this is; without it, it
   * decides nothing and two projects share one baseline.
   * Absent for a runner with no projects and for an unnamed one.
   */
  readonly project?: string;
}

/**
 * The key a test's observation is stored under: its subject, the file the test
 * is declared in, and the titles it was declared under.
 *
 * `titles` run outermost first — the `describe` blocks, then the test's own —
 * and are given apart rather than read back from the subject id, because a
 * runner joins them with a separator a title may contain. The last is the
 * baseline's `name` and the rest its `title`, which is all a template needs to
 * write a path a reviewer reads as *this test*.
 *
 * The file and the titles decide only where the baseline is filed. The subject
 * decides which baseline it is, with the project when the template places by
 * `{project}`.
 */
export function testBaselineKey(
  subject: string,
  declared: { readonly file?: string; readonly titles?: readonly string[]; readonly project?: string } = {},
): BaselineKey {
  const { file, titles, project } = declared;
  return {
    subject,
    ...(file === undefined ? {} : { file }),
    ...(project === undefined || project === '' ? {} : { project }),
    ...(titles === undefined || titles.length === 0
      ? {}
      : {
          ...(titles.length > 1 ? { title: titles.slice(0, -1).join('/') } : {}),
          name: titles.at(-1)!,
        }),
  };
}
