---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask uses` finds a field used through the types that carry it

`variance ask uses --name size` listed a use of `Props.size` only where the line
annotated its own binding as `Props`. It now also lists:

- a literal returned from a function whose return type is `Props`;
- `this.size` inside a class that implements or extends `Props`, or in a
  function whose `this` parameter is `Props`;
- `Props['size']` in a type;
- a use written as an interface that extends `Props`, as an alias that is or
  intersects it, or as a class that implements it;
- a component annotated `FC<Props>` or `React.FunctionComponent<Props>` that
  reads or destructures its props;
- a JSX attribute, `<Button size={2} />`, on a component that takes `Props`.

The declaring file is read by the same rules. A `function` inside a class binds
its own `this` and lists nothing. The source index format moves to version 24,
so the next `variance index` writes a fresh generation.
