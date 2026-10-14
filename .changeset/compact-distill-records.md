---
"@variance-authority/sense": patch
"@variance-authority/cli": patch
---

Read scope distillations from stored case sets without expanding the whole record into crossing objects. Identical entry sets within each module are read once, keeping large JSONL scope reports within the normal Node heap.

Whole coverage reads decompress their string dictionary once, avoiding repeated reads of compressed string runs.
