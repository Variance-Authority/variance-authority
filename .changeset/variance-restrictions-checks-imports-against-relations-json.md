---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

`variance restrictions` checks imports, import chains, layers and package sizes against the rules in `.relations.json` files

A `.relations.json` is a list of rules, or an object whose `rules` is one. A rule is `{ "from": …, "to": …, "type": "allowed" | "restricted", "message": … }`, where `from` and `to` are a folder, a glob or `*`, written relative to the directory of the file. It is the `restrict` rule of `eslint-plugin-relations`, written as JSON and checked over the imports in the source index. For each import, every tracked `.relations.json` in the directory of either end, or in a directory above it, applies. The deepest file is read first, the first rule that matches decides, and an import no rule matches is allowed. `variance restrictions` prints each restricted import with the rule file that decided it and exits 1 when anything is restricted, 0 when nothing is. `--format json` prints the findings as `violations`, `chains`, `capped` and `tiers`.

Three more kinds of entry are checked:

- **`"transitive": true`** on a rule checks it along chains of imports, type-only imports included: from each file a package ships to every file its imports lead to. A test file never starts a chain. Each finding is the last import in the chain, the one into the restricted file, because that is the line to change. It is printed with the shortest chain and the number of shipped files that lead to it.
- **`{ "for": "packages/*", "maxLayer": 5 }`** fails the check for each package under `for` whose layer is above 5, as `variance layers` numbers it. When several entries name one package, the lowest ceiling decides.
- **`{ "for": "packages/*", "maxTier": 1 }`** fails it for each package whose size is over the tier 1 budget of the `tiers` in the root `variance.config.json`, the second entry of that list: 20000 for `[200000, 20000, 1000]`. When several entries name one package, the smallest budget decides. A package whose measured lines fit the budget, but with files that could not be sized, is printed as undecided and does not fail the check.

A transitive rule or a `maxTier` stops and asks for `variance index` when the code map was built from an older source index. The command refuses, with the file and the rule number, an entry that mixes `for` with `from`, `to`, `type` or `transitive`; an entry with both `maxLayer` and `maxTier`; `maxTier: 0`; a tier the config does not declare; and any `maxTier` when the config declares no `tiers`. `relationBetween`, `chainBetween`, `restrictedImports`, `restrictedChains`, `cappedLayers`, `cappedTiers` and `shippedFiles` in `@variance-authority/sense` are what it reads.
