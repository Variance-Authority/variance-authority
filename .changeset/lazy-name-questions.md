---
'@variance-authority/cli': patch
'@variance-authority/mcp': patch
---

A question about names (`ask symbol`, `ask uses`, `ask search`) no longer loads the distiller, the report reader or the claim and vantage readers it never calls; on Kibana each call is about 20 ms faster.
