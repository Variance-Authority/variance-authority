# @variance-authority/distill

`distill` combines one test's Eyes attention journal with its Sense execution
index. It reports the UI the test addressed by authored Arrange/Act/Assert
phase, React update initiators inside and outside those addressed paths, and
entered source files with no addressed target attribution.

```ts
import { distill, formatDistillation } from '@variance-authority/distill';

const result = distill({ test: 'checkout submits', eyes, execution });
console.log(formatDistillation(result));
```

`DistillInput` is the supplied evidence and `Distillation` is the portable
result. `AddressedPhase`, `UpdatePhase`, and `EnteredFile` name its ordered
records. `formatDistillation` renders the text used by the CLI and MCP adapters.

An entered file without addressed attribution is a distillation opportunity,
not a safe mock. The deterministic reading supplies candidates; a test-changing
workflow must try a substitution, rerun the test, and compare the witness.

Eyes evidence is optional. A non-React test can still report entered source;
React attention is absent rather than zero when no Eyes archive is supplied.
`parseExecutionIndex` validates untyped execution JSON at a process boundary.
