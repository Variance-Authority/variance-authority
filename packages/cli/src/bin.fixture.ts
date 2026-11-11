/**
 * The modules `main` loads on its first command, loaded for a test before it
 * calls `main`. `main` imports them only once a command is named, so `--version`
 * waits on none of them; a test that imported `main` alone paid that load in
 * its first case, against the case's time limit, where a cold runner spent
 * five seconds on it. Imported beside `main`, it is the test file's import.
 */
import './commands/configless.js';
import './commands/index-follow-ups.js';
import './dispatch.js';
