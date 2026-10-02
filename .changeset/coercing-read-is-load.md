---
'@variance-authority/sense': patch
---

A changed value that a file converts at top level as it loads is read as a load
of that file, so the tests that load it are selected. `const doubled = feature * 2`,
`` `${feature}` ``, `-feature`, `feature == 1`, `key in feature`,
`feature instanceof Base` and `{ [feature]: true }` each convert the value, and
the conversion can throw or run the value's own `valueOf`, `toString` or
`Symbol.toPrimitive` when the file loads — `1n * 2` throws. A test file holding
one is selected even when nothing reads the binding afterwards. A plain copy, an
object value, `===`, `!==`, `!`, `typeof`, `??` and a condition convert nothing
and still select only the tests that read the binding.
