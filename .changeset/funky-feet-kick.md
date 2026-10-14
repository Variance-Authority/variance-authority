---
'@variance-authority/sense': patch
---

Load the Jest transformer through CommonJS host loaders

Jest can load the recording transformer when a host loader transpiles its ES module to CommonJS with `__esModule`. The transformer exposes its factory through a default export as well as its named export, so recording works without a local adapter.
