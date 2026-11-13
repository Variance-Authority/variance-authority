---
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
'@variance-authority/playwright-test': minor
---

The record keeps how each attempt of a retried case ended. A runner that retries a failing case reports the last attempt, so a case that failed and then passed read as a pass. A recorded run under Vitest, Jest, Rstest or Playwright now writes one row per attempt of every case its runner ran more than once: how the attempt ended, how long it ran and, for one that did not pass, the failure's message and its frame inside the checkout. A case that ran once adds nothing, and its `stopped`, duration and limit are unchanged.

`variance ask retried-tests` (`docs_retried_tests`) lists the cases whose attempts ended differently in the recorded run, each with its attempts and its limit, under the record's origin, commit and age. A record written before attempts were kept says that they were not kept, not that no case was retried.

A build older than this one refuses a record that holds the new `cases.attempts` section, as it refuses any section it does not know. No selection reads the section.
