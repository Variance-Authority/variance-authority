---
'@variance-authority/core': patch
---

`wait-for-fonts` gives up after 15 seconds and names the font

A web font whose request never answered kept `document.fonts.ready` pending, and
the capture waited forever. `wait-for-fonts` now waits at most 15 seconds, the
same bound as `wait-for-images`, then fails naming every font still loading:
its family, and the `src` that requested it when the stylesheet declaring it is
same-origin. A face declared in a cross-origin stylesheet is named by family
alone, because the page cannot read that sheet's rules.
