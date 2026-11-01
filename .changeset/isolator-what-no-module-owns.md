---
'@variance-authority/isolator': minor
---

Isolate what no module owns, per session, from the main entry: `isolateEnv()` gives each test its own `process.env`, `isolateGlobals()` puts global properties back as each test ends, `isolateTimers()` cancels the timers a test leaves pending, and `isolateListeners()` removes the event listeners it leaves attached, telling `report` where each was added. `perSession(object)` is the proxy beneath `isolateEnv`, for any other object. What setup does before the first test, a Storybook preview as it boots included, stays in every session. They run in Jest, Vitest, a web bundle built with the Rspack or webpack loader, and Storybook, where `isolateEnv()` installs nothing without a `process`.
