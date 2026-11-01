# Watchman

## What it is

A file-watching server the adopter already runs over the checkout, for an
editor, a bundler or Jest. It keeps a clock per watch and answers which files
moved since any clock it handed out.

## Good at

Saying that nothing moved. An update that held the tree it was made against
asks once and, on an empty answer, lists nothing with git.

## Bad at

Saying what git sees. It reports paths, not whether git tracks or ignores
them, and nothing about git's own inputs outside the watch: the configuration,
the excludes file, HEAD.

## How it breaks

A restarted server has no history back to an old clock and says so as a fresh
instance; `ignore_dirs` hides paths from every answer, and `ignore_vcs` hides
the directories it names at the watched root; no server listens. Each
is no answer, and the update lists with git as it would without Watchman.

## How you talk to it

Its JSON protocol over the server's socket: `watch-list`, `get-config`,
`clock` and a `since` query. The socket comes from `$WATCHMAN_SOCK` or
`watchman --no-spawn get-sockname`. Nothing starts a server or adds a watch.

## Their chart

—
