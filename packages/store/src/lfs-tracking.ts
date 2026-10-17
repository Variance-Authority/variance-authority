// compass: variance-authority.retention
import { messageOf } from '@variance-authority/raster';
import type { CommandResult, CommandRunner } from './lfs.js';
import { firstLine } from './lfs-fetch.js';

/**
 * Ask git what it will actually do with a matching path.
 *
 * `git check-attr` rather than reading back the file just written: the file is
 * evidence of intent, and attributes resolve through every `.gitattributes`
 * between the repository root and the path plus the operator's global config, so
 * an entry can be present and overridden. The question worth answering is what
 * git resolves, not what this package wrote.
 *
 * `git lfs version` as well, because the filter can be configured on a machine
 * where the program implementing it is not installed — in which case commits
 * succeed, nothing warns, and the images go into the object database whole.
 */
export async function checkTracking(
  cwd: string,
  pattern: string,
  run: CommandRunner,
): Promise<{ filter: string | null; diagnostics: readonly string[] }> {
  // check-attr answers for a path, not for a glob, so a representative path is
  // synthesised from the pattern. It need not exist; git resolves attributes on
  // the name alone. A leading slash anchors a pattern to the attributes file's
  // directory and would be read as an absolute path here, so it is dropped.
  const probe = pattern.replaceAll('*', 'probe').replace(/^\/+/, '');

  let attributes: CommandResult;
  try {
    attributes = await run('git', ['check-attr', 'filter', '--', probe], { cwd });
  } catch (error) {
    return {
      filter: null,
      diagnostics: [
        `git could not be run (${messageOf(error)}), so LFS tracking of \`${pattern}\` in ` +
          `${cwd} is unverified. Baselines are still written and read as ordinary files; ` +
          'what is unknown is whether committing them will store pointers or whole images.',
      ],
    };
  }

  if (attributes.code !== 0) {
    return {
      filter: null,
      diagnostics: [
        `\`git check-attr\` failed in ${cwd} (exit ${attributes.code}: ` +
          `${firstLine(attributes.stderr)}), so LFS tracking of \`${pattern}\` is unverified. ` +
          'A baseline root outside a work tree is durable but not shared by a clone.',
      ],
    };
  }

  const filter = /:\s*filter:\s*(\S+)\s*$/.exec(attributes.stdout.trim())?.[1] ?? 'unspecified';
  const diagnostics: string[] = [];

  if (filter !== 'lfs') {
    diagnostics.push(
      `git resolves \`filter\` to \`${filter}\` for ${probe} in ${cwd}, not \`lfs\`; ` +
        'something above this directory is overriding the entry, and images will be ' +
        'committed whole',
    );
  }

  try {
    const lfs = await run('git', ['lfs', 'version'], { cwd });
    if (lfs.code !== 0) {
      diagnostics.push(
        'git-lfs is not installed on this machine (`git lfs version` exited ' +
          `${lfs.code}); the filter is configured but nothing implements it, so images ` +
          'will be committed whole and a clone will not get pointers',
      );
    } else {
      // Installed is not set up. A package manager installs the binary; `git lfs
      // install` is what tells git to run it, and `actions/checkout` runs that
      // only with `lfs: true`.
      const clean = await run('git', ['config', '--get', 'filter.lfs.clean'], { cwd });
      if (clean.code !== 0 || clean.stdout.trim() === '') {
        diagnostics.push(
          `git-lfs is installed but \`filter.lfs.clean\` is unset in ${cwd}, so git does not ` +
            'run it: images will be committed whole, and `git lfs pull` leaves pointers in ' +
            'place. Run `git lfs install --local` (add `--skip-smudge` to keep checkouts ' +
            'from downloading every image)',
        );
      }
    }
  } catch (error) {
    diagnostics.push(`git-lfs could not be checked (${messageOf(error)})`);
  }

  return { filter, diagnostics };
}
