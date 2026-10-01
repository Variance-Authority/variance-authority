---
"@variance-authority/cli": patch
"@variance-authority/help": patch
---

The help server and `variance serve` describe every source question they answer

`variance-authority-help --help` said `serve` answers "all six" questions, and the instructions `variance serve` sends an MCP client said "nine"; both serve eleven. Neither states a count now, and the `variance serve` instructions name the two they had left out: which third-party packages a location can use (`docs_stack`) and which code the recorded tests ran around a file (`docs_journey_map`). The verb list in `--help` is padded to its longest verb, so `slowest-tests` and `journey-map` no longer run into their descriptions.

The READMEs of both packages link the documentation on variance-authority.dev instead of a repository-relative path, which does not resolve where npm shows them.
