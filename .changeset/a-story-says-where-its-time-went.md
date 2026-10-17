---
'@variance-authority/storybook': minor
'@variance-authority/storybook-collector': minor
'@variance-authority/sense': minor
---

A story's execution record now says where the browser spent it, timed by the page: `prepare` for the preview's load, paid by the first story read on a document and 0 for every later one; `collect` for importing the story's file and unmounting the story before it; `cases` for the render through `afterEach`. `collectStory` returns them as `timing`, and `watchStoryTiming` starts the page's watch; the collector's page agent runs it.
