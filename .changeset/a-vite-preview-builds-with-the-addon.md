---
'@variance-authority/storybook-collector': patch
---

A Vite Storybook with a `.storybook/preview` file builds with the addon

From Storybook 9.1 on, Storybook rewrites each `sb.mock(import('../lib/api'))`
in the preview file to `sb.mock('../lib/api')` by printing the whole file
again, with no map back to your lines, so `storybook build --test` stopped at
the probes on any preview, whether it mocked a module or not. The addon now has
that rewrite edit the file in place: `import(` and its closing parenthesis
become spaces, every other character keeps its line and column, and the
preview's decorators are recorded where you wrote them. Storybook 10 builds the
same way. A Storybook that rewrites more calls than the edit in place makes
stops the build with an error that names `storybook:mock-loader-preview` and
the preview, rather than shipping a mock that no longer mocks.
