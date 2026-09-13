---
'@variance-authority/jsx-source': patch
'@variance-authority/storybook-collector': patch
---

Where the JSX settings live under Vite 8

Vite 8 transforms with oxc, so `esbuild: { jsx, jsxDev, jsxImportSource }` becomes
`oxc: { jsx: { runtime, development, importSource } }`, and `esbuild.keepNames`
becomes `build.rolldownOptions.output.keepNames`. A config keeps whichever keys it
is given and reads only the ones its own major knows, so the wrong block is not an
error, not a warning and not a log line: the plugin installs, the bundle runs,
every subject renders, and every report names the line a component is declared on
instead of the line that wrote the element. It fails in the direction that looks
like it worked.

The `jsx-source` README carries a table of where the two settings live per
transform, both spellings on every copyable snippet, and the reminder to read
`provenanceOf`'s result rather than the config — the config cannot tell you.
`storybook-collector` gets the same for `keepNames`, on the symptom it produces: a
confident report naming a component that appears nowhere in your source.
