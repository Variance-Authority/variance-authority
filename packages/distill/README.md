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
result. `AddressedPhase`, `UpdatePhase`, `EnteredFile`, `EnteredModule` and
`Region` name its ordered records. `formatDistillation` renders the text used by
the CLI and MCP adapters.

## A module the test loaded but never entered

An import is not a use. `import { A } from './B'` runs `B`'s top level, and
nothing else in `B` runs unless something calls into it — a spy answers in `A`'s
place, or the branch that would have rendered it is never taken. Both leave one
trace: the module root crossed, every declaration below it uncrossed.

`EnteredFile` answers whether the test was ever inside a file, which is the
question test selection asks and the one it must over-answer. `EnteredModule`
answers which regions of that file the test was inside. `loadedOnly` marks the
first case; `unentered` names the declarations nothing reached.

```text
Loaded but not entered: 1 module(s).
  src/heavy-chart.tsx — the import ran its top level and this test entered nothing below it
    never entered: HeavyChart (lines 5-8)
    substitution to try: vi.mock('src/heavy-chart.tsx') — jest.mock and sb.mock say the same thing
```

A module root has no caller a test could be, so `loadedOnly` is derived from the
region's own kind and asks nothing of the producer. A producer that watched the
evaluation may also mark a crossing below the root `loaded` — a function the top
level called — and that mark is believed over the kind.

Mocking takes the top level with the rest. Where that top level registers
something, installs a polyfill, or builds a singleton, the test is standing on
it. Make the substitution, rerun the exact test, and compare the witness.

An entered file without addressed attribution is a distillation opportunity,
not a safe mock. The deterministic reading supplies candidates; a test-changing
workflow must try a substitution, rerun the test, and compare the witness.

Eyes evidence is optional. A non-React test can still report entered source;
React attention is absent rather than zero when no Eyes archive is supplied.
`parseExecutionIndex` validates untyped execution JSON at a process boundary.
