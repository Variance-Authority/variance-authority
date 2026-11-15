---
'@variance-authority/sense': patch
---

A source index segment holding a flag byte other than 0 or 1, or a symbol reach the format does not know, is now refused by the native reader as the TypeScript reader refuses it, so a damaged index is rebuilt instead of read with its dependencies silently dropped.
