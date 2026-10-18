---
'@variance-authority/react': minor
'@variance-authority/sense': minor
---

A story names React objects by React's own word

Add `@variance-authority/react/story` to a suite's setup files, and a story
shows a context, a memo or an element it was handed as `react.context`,
`react.memo` or `react.transitional.element`, read from the `$$typeof` mark
React gave it. Without it, each is an `Object`.

Sense's story tap knows no framework. It asks the functions a realm puts in
its `Symbol.for('variance-authority.story.kind')` array what an object is, the
first that answers a word names it, and one that throws is passed over.
