---
'@variance-authority/package': patch
'@variance-authority/help': minor
'@variance-authority/cli': patch
---

`variance index` reads each package manifest once

After the source index, `variance index` publishes the workspace's answers.
First it tries to refresh the answers it published last time. When that cannot
apply, on the first run or when the member list or the exported names have
changed, it reads the whole workspace again. Each of those steps listed the
members and read the manifests for itself, the refresh once or twice and the
workspace read twice: once for what each package publishes, and once for where
an import between packages lands. A first run read every manifest twice, a run
whose refresh could not apply three or four times, and one whose refresh
applied once or twice. On a product that lists two thousand
members, one read of them takes seconds.

Each manifest is now read once per run. `readWorkspaceManifests` gives both
answers from one read, and `publishWorkspaceFromIndex` hands them to the
refresh and, if it cannot apply, to the workspace read.

`refreshWorkspaceFromIndex` is withdrawn from `@variance-authority/help`. It was
the refresh half alone, and it read the manifests for itself; call
`publishWorkspaceFromIndex`, which refreshes when it can and reads the workspace
when it cannot.
