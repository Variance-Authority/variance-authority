---
"@variance-authority/sense": minor
"@variance-authority/playwright-test": minor
"@variance-authority/storybook-collector": minor
---

Declare source-consuming imports with `sourceConsumed` when instrumenting before a compiler or other syntax consumer. No library rules are enabled by default. Supply the same rules to the build and recording driver; their instrumentation identity and native recipe include the configuration, and a mismatched journal is refused. Selected arguments or template interpolations retain their function syntax, while runtime calls keep their probes. Native callers use `instrument_with` and `recipe_with` with the same rules.
