---
"@variance-authority/cli": patch
---

The skill tells an agent where to look past the comment above a name

`symbol` prints the comment above a declaration or, when there is none, the nearest README's passage if it names the name; a docs folder, an architecture chart, a decision record or a wiki is never read. The `variance-authority` skill now routes a question about why a name exists or what it connects to to a new reference, `written-about-a-name.md`. It has the agent search those documents for the declaring file's path and then each parent directory, stopping at the first chart or decision record or at the package root, then for the name and its specifier, then open any address the file names, ask a wiki outside the checkout only through a tool the session already has, and say which places it searched.
