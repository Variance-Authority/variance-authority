---
'@variance-authority/storybook': patch
---

A story switched to over the channel costs its render and nothing fixed

Each story used to pay about 112 ms that it did not spend rendering: Storybook's
own 100 ms timer before it looks for running animations, and a poll for
`storyFinished` that asked every 50 ms. `collectStory` now sets the switch
Storybook reads to skip that timer on each document it navigates, removes the
animation-pausing stylesheet that switch also adds so your page keeps its
animation state, and hands a story on when `storyFinished` arrives. On the case
Storybook a switched story went from about 112 ms to about 3.3 ms, with every
capture unchanged. The first story of a document still pays Storybook's timer
once.

A first story whose render was already over before the adapter started watching
is now taken as finished, rather than waited on for `timeoutMs` and the preview
then treated as one that never emits `storyFinished`.
