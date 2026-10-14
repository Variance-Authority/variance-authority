---
'@variance-authority/distill': patch
---

Naming the import behind each unused load no longer reads a module's loaders once per import

When `variance distill` names which import made a test file load a module no
case of it entered, it walks the imports the file followed. To decide whether
the file followed each one, it searched the list of test files that loaded the
module until it found the file, for every import edge and every test file, so a
module many test files load was read again for each of them. Each module's
loaders are now read once into a set, shared by every test file that asks.
