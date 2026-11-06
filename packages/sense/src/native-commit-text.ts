/**
 * Files at commits, as the addon's `commit_text.rs` answers them: many together
 * as columns, or one at a time from the `git cat-file --batch` left open.
 */

/** `asked[commit[at]]` holds `file[at]` as `text[at]`; beside them what git could not read, and why. */
export interface NativeTextColumns {
  commit: number[];
  file: string[];
  text: string[];
  refusedCommit: number[];
  refusedFile: string[];
  refused: string[];
}

export interface NativeCommitTexts {
  /** `paths[at]` at `commits[at]` as columns: a path the commit does not hold left out, one git could not read refused with git's reason; throws when git answers nothing. */
  textsAt?(root: string, commits: string[], paths: string[][]): NativeTextColumns;
  /** One path at one commit from a `git cat-file --batch` left open, `null` a path the commit does not hold; throws git's reason for one it could not read. */
  textAt?(root: string, commit: string, file: string): string | null;
  /** In a partial clone, fetches the blobs `commit` names at `files` in one request. */
  fetchTextsAt?(root: string, commit: string, files: string[]): void;
  /** `textsAt`'s listing without the bodies: each path's blob name, `git:<object>`, in the same columns. */
  blobsAt?(root: string, commits: string[], paths: string[][]): NativeTextColumns;
  /** Why `commit` cannot be read here when this checkout's object store does not hold it, with the fetch that brings it. */
  commitAbsent?(root: string, commit: string): string | null;
}
