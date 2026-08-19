# Additive Playwright Test case

This case proves the adopter contract through the actual Playwright Test CLI.
The consumer spec keeps `test` and `expect` from `@playwright/test`, imports only
observation helpers from Variance Authority, refuses an unapproved first
candidate, accepts it under an explicit update flag, and observes it unchanged
in a third Playwright process.

The outer Vitest file is orchestration only: it creates an isolated baseline
directory and launches those three consumer processes.
