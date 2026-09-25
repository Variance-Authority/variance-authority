---
'@variance-authority/sense': patch
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-arm64-gnu': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

A type in a decorated class is now read as a load-time change. Under `emitDecoratorMetadata`, TypeScript writes the types of a decorated class's constructor parameters and decorated members into metadata calls that run when the class is defined, and a dependency-injection container reads them. Changing the type of an injected service used to read as `none` and select nothing. A changed parameter decorator such as `@Inject(TOKEN)`, which also runs when the class is defined, used to read as a function body. Types inside method bodies, and in classes with no decorator, still select nothing.
