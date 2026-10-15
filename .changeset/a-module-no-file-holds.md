---
'@variance-authority/sense': patch
---

A module no file holds is not probed

A builder hands its own virtual modules to the same transforms as your code,
under a path in your project: Storybook's `storybook-stories.js` and
`storybook-config-entry.js` sit at the root, and the default `include` accepted
them. Every seam probed them, and the record named a file no commit holds, so
the run that loaded one was recorded incomplete. A module with no file on disk
is now left alone at every seam, inside `node_modules` too where your `include`
accepts it.
