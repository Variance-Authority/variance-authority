---
'@variance-authority/help': minor
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

Map search candidate files before opening names

Use `variance ask search --query "retry payment" --map root` to group every
candidate file by code-map area and dependency layer. Follow emitted group
drills through areas and packages to files, retaining near-match qualifications
and unread frontiers. `--format json` includes the map as `candidateMap`.
The optional view leaves default detailed search unchanged.
