---
"@variance-authority/package": patch
"@variance-authority/help": patch
---

An `exports` field written as conditions opens `.`, and a custom condition in `tsconfig.json` is followed

An `exports` string, an array of fallbacks, or an object with no `.` key now publishes `.`, as Node reads it. Before, each condition key was taken as a subpath, which invented names such as `@tanstack/solid-querytanstack/custom-condition`. An object that mixes subpaths and conditions is refused and the manifest is named, because Node refuses to load it. A condition listed in the package's `tsconfig.json` `customConditions` (through `extends`) is followed to the source it names when it comes before `types`, so Zod's `@zod/source` and TanStack's `@tanstack/custom-condition` open their `src/` files. A pattern target with no extension, such as `./src/v4/locales/*`, opens one subpath per TypeScript file it matches, spelt with the emitted extension. An import of a subpath that `exports` names exactly is no longer reported as reaching past a published entrypoint when that subpath's source could not be read; it is listed under unreadable instead.
