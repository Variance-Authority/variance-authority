---
'@variance-authority/storybook-collector': minor
'@variance-authority/cli': minor
---

A Storybook run's recording times each story with the time the run spent on it

The run hands its collector the time it spent on each subject, from the first collection to the decision, as the collector closes — `close(costs)`, where `costs` maps a subject id to whole milliseconds. The Storybook collector records that figure as each story's duration, on the story's row and on its case, so `variance ask slowest-tests` ranks stories by the same time `variance ask costs` reports and the next run shards on. A story read more than once is timed once, and a story the run did not time has no duration.
