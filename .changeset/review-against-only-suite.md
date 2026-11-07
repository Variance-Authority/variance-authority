---
'@variance-authority/cli': patch
---

`variance review --coverage --against <file>` compares the only declared suite with that base when no `--suite` names it. It used to drop the base without saying so.
