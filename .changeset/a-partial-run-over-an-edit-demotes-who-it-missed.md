---
"@variance-authority/sense": patch
---

A test a partial run did not observe runs again after its code was edited under that run

When a run of some tests lands over an uncommitted edit, the record keeps the edited text and selection reads later changes from it. A test that was not in the run but had entered an edited region kept its crossing and stayed whole, and the next selection, diffing from the kept text, saw no change and skipped it — though it never ran over the edit. Landing now demotes every such test to incomplete, so it runs at the next selection and is recorded again. An edit at a module's top level demotes every test that loaded the module and was not in the run.
