---
'@variance-authority/cli': patch
---

`variance doctor` answers on a `variance.config.json` that names none of the five render settings, the kind the schema allows for a repository using only the configless commands. It prints `renderer: not checked` and the cache, skills and TypeScript findings, and exits `0`, where it used to refuse the file for a missing `profile`. A misspelled setting, a setting only the repository root may hold, or a file naming some of the five, is still refused, and `doctor --baselines` still needs a file that renders.
