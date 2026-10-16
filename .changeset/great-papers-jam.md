---
"@variance-authority/sense": patch
---

Cancel pass-through mock import adjustments

A mock factory that loads the same module it replaces leaves existing imports unchanged and no longer adds a dependency from registering the mock. A factory loading another module still replaces the mocked dependency with that module. Real loads outside a mock factory retain their dependencies.
