# Journal 0031 — The archive had no clock

**Date:** 2026-08-26

A saved MHTML of the Briefcase underwriter page supplied a 15,426px application
page with 863 rendered elements. Treating its body as one subject obscured the
actual structure: a shell navigation, case header, ten-tab flow, four summary
tiles, five independent content panels, a 31-article demand list, and a footer.

The first public acquisition did not finish. The archive had no incomplete
images, its fonts reported loaded, and direct collection of the 15-node
navigation took 39ms. The default stabilization still waited because the saved
document's page timers and `requestAnimationFrame` did not advance. An MHTML
archive cannot animate, so the Playwright entry exposed the existing recipe
override and accepted `stabilize: []` as an explicit caller declaration of a
static document. Live pages retain the default recipe.

Applying the public entry points at the actual structural owners then produced:

| Subject | Graph nodes | Acquisition | Structural reading |
|---|---:|---:|---|
| Shell navigation | 15 | 213.42ms | Composition only; no finding |
| Case tab flow | 11 | 31.96ms | Ten tabs at 191.03px vertical centre, 0px spread |
| Summary tiles | 13 | 29.88ms | Four repeated immediate children, no owner finding |
| Demand-list box | 599 | 490.14ms | 31 immediate article children, five owner patterns and four owner findings |

The demand report contained another 103 findings under 165 nested owners. The
default owner focus did not fold them into the list. Its four retained findings
were three baseline readings inside the security-for-costs article and one
presentation-signature departure for an unusually long disclosure article in a
nine-instance pattern. They remain measurements, not instructions to shorten the
disclosure or redesign the list.

The same archive therefore exercised all three readings the package distinguishes:
a flow selected across controls, a repeated box read at one level, and a large
composition decomposed before its findings were interpreted. The 599-node box
finished in under half a second once the caller accurately described the archived
world.
