---
'@variance-authority/sense': patch
---

`variance index` resolves the files it has read while it reads the rest

The walk that builds the source index read and parsed every file of a wave before it resolved any of their imports, so a cold index waited for the whole read and then for the whole resolution. It now reads a wave in slices and resolves each slice while it reads the next. The index it publishes is unchanged, byte for byte. On Kibana, a cold `variance index` (115k files) is about a second sooner, 9.1 s against 10.2 s at the median of eight interleaved runs, with the same peak memory.
