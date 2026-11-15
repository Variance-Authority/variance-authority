---
'@variance-authority/help': patch
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

A source file is read once, by the parse that indexes it

The source index keeps the text of every doc comment, declaration head and
member and export line an answer prints, cut from the source the parse already
held, so reading a workspace and answering about it no longer open each file a
second and third time to cut those lines out. The doc and head rules run in one
place, the native index, and `@variance-authority/sense` exports `exportLine`
for the line an export is written on.
A file the parse could not read is recorded as unreadable rather than read again
from JavaScript.

An answer now prints a file's text as the index read it, also when the file was
written since: the date line still says the checkout was not compared, and
nothing of what the file holds today is mixed into it. The source index format
moves to version 47, so the first command after upgrading reads the checkout
once more.
