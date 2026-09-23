---
'@variance-authority/wire': minor
'@variance-authority/sense': patch
---

A driver a head first hears from late still gets every subject's initialization

A head reported what ran outside any request, and what a module ran while it
initialized, to whichever driver's request happened to be open. Under two
workers the second never heard it, so its subjects missed the lines every
request depends on, and a change to a module's top level could skip them.

A head now keeps that account and sends each driver the part it has not been
told, the first time that driver's request settles. `Channel.home` names the
driver a channel reaches, which is what the head keys on.
