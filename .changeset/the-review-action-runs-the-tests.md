---
'@variance-authority/cli': minor
---

`Variance-Authority/action/review` takes `test`, your test command: it restores the named suite's record and the pull request's last push from the runner cache, sets the mainline's record aside, runs the command, reviews against it, and saves what the tests ran, so a unit-only job is checkout, install and one `uses:` with `suite` and `test`. A red test still reviews and saves, then fails the step with the test's exit code. Without `test` the action reviews as before.
