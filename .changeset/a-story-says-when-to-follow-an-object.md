---
'@variance-authority/cli': patch
---

The `variance-authority` skill now sends an agent to a story when it needs to know where one object went or came from: which provider's value reached a component as a prop, or whether a wrapper passed an object on or replaced it. It follows the object's ref from step to step.
