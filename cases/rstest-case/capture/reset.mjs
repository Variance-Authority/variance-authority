import { resetCaptures } from '@variance-authority/unit-test';

/**
 * Empty the capture directory once, before any test file runs.
 *
 * `writeCapture` refuses a second capture under a subject id that already has
 * one, so a directory carried into a second run fails on it. Doing this from a
 * test file instead would race the other files and delete their captures —
 * which is why it is Rstest's `globalSetup` and not a `beforeAll`.
 */
export default async function () {
  await resetCaptures(process.env.VARIANCE_CAPTURE_DIRECTORY);
}
