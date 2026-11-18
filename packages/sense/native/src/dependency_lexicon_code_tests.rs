//! Retained declaration facts and complete source reads across the shared syntax boundary.

use super::Code;
use oxc_allocator::Allocator;
use serde_json::json;

const CASES: &[(&str, &str)] = &[
    ("source.ts", concat!(
        "/** Module 😀. */\r\n\r\n",
        "/// <depends path=\"./extra\" />\r\n",
        "import { item as held } from './item';\r\nimport * as ns from './ns';\r\n",
        "/** Public 😀. @testOnly */\r\nexport function run(value: string): number;\r\n",
        "export function run(value: number): string;\r\n",
        "export function run(value: unknown) { function inner() { return held; } return inner(); }\r\n",
        "export interface Shape { /** Member. */ value: string; method(): void; }\r\n",
        "export const read = (shape: Shape) => shape.value;\r\n",
        "const { taken } = ns; export { held as alias }; held.value; ns.more;\r\n",
        "export const Component = 1;\r\n",
        "vi.mock('./mocked'); jest.requireActual('./actual');\r\n",
        "export async function later() { return (await import('./lazy')).pulse; }\r\n",
    )),
    ("module.d.ts", concat!(
        "import type { Input as Argument } from './input';\n",
        "import * as shared from './shared'; export { shared };\n",
        "/** Pulse 😀. @testOnly */\nexport declare function pulse(value: Argument): string;\n",
        "export declare function pulse(value: number): boolean;\n",
        "export type { Input as Published } from './input';\nexport * from './all';\n",
        "declare class Joined {} interface Joined {} export { Joined };\n",
        "declare const 𐐀: true; declare const Ｚ: true; export { 𐐀, Ｚ };\n",
    )),
    ("common.cts", concat!(
        "const kit = require('./kit'); const { first: renamed } = kit;\n",
        "/** Function 😀. */\nfunction run() { return renamed; }\n",
        "module.exports = { run, alias: renamed };\n",
    )),
    ("namespace.d.ts", concat!(
        "export = Kit;\ndeclare namespace Kit {\n",
        "/** Pulse 😀. */\nfunction pulse(value: string): boolean;\n",
        "function pulse(value: number): string;\ninterface Shape { value: string }\n}\n",
    )),
    ("bridge.d.ts", "import Kit = require('./namespace');\nexport = Kit;\n"),
    ("unknown.ts", "/// <depends />\nimport(name); require(other);\n"),
    ("malformed.ts", "export const broken = ;\n"),
];

#[test]
fn complete_source_facts_stay_exact() {
    let mut observed = Vec::new();
    for (file, source) in CASES {
        for symbols in [false, true] {
            let read = crate::read::read_module(file, source, &Allocator::default(), symbols);
            if *file == "source.ts" && symbols {
                assert!(!read.requests.is_empty() && !read.exports.is_empty() && !read.symbols.is_empty());
                assert!(!read.nested.is_empty(), "nested");
                assert!(!read.declares.is_empty(), "declares");
                assert!(!read.mocks.is_empty(), "mocks");
                assert!(!read.members.is_empty() && !read.binding_members.is_empty());
                assert!(!read.member_declarations.is_empty() && !read.member_uses.is_empty() && !read.own_uses.is_empty());
                assert!(read.size.is_some() && read.doc.is_some() && read.unknown.is_none());
            }
            let text = serde_json::to_string(&read).unwrap();
            observed.push((file.to_string(), symbols, crate::digest::of_string(&text)));
        }
    }
    let expected = [
        ("source.ts", false, "v1:6574db4bef6ca63846c824bd7da50b2f"),
        ("source.ts", true, "v1:ddea804fe533fd37604b6b7064969489"),
        ("module.d.ts", false, "v1:1d769c3e6778800d33bbd843deeef630"),
        ("module.d.ts", true, "v1:a5f9a637203d7282ceb5a6eefde7ef04"),
        ("common.cts", false, "v1:d9e3f8b091798f995caa21bfcfe93725"),
        ("common.cts", true, "v1:0af9a845a8addc736e1646cbc56deaaa"),
        ("namespace.d.ts", false, "v1:bfdb96502e46e52189f9833c6b8155eb"),
        ("namespace.d.ts", true, "v1:b8430580a4aec474cf2ac62b5d8d722d"),
        ("bridge.d.ts", false, "v1:2683697211cde1d072a4a76741378f86"),
        ("bridge.d.ts", true, "v1:829438a4d3ffd36555459f6be38ea41f"),
        ("unknown.ts", false, "v1:6a98583ac75da489fa77d97a3f635ba4"),
        ("unknown.ts", true, "v1:ff08e0446213671a0900d568ee5cd483"),
        ("malformed.ts", false, "v1:5e1cd102dedecf030c3f7d771796a195"),
        ("malformed.ts", true, "v1:e77839218fe5c977bfba860091ceb8be"),
    ].map(|(file, symbols, digest)| (file.to_owned(), symbols, digest.to_owned()));
    assert_eq!(observed, expected);
}

#[test]
fn declaration_facts_stay_exact() {
    let root = std::env::temp_dir().join(format!("sense-declaration-contract-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let mut observed = Vec::new();
    for (file, source) in CASES {
        let path = root.join(file);
        std::fs::write(&path, source).unwrap();
        let (code, bytes) = Code::read(&path).unwrap();
        assert_eq!(bytes, source.len());
        assert!(code.exports.iter().all(|export| export.line_text.is_none()));
        let imports: std::collections::BTreeMap<_, _> = code.imports.iter().collect();
        let namespace: Vec<_> = code.namespace.iter().map(|symbol|
            (&symbol.name, &symbol.kind, symbol.line, &symbol.signature, &symbol.doc)).collect();
        let facts = json!([code.digest, code.exports, code.symbols, imports, namespace, code.assigned_imports, code.unknown, code.text_bytes()]);
        observed.push((file.to_string(), crate::digest::of_string(&facts.to_string())));
    }
    std::fs::remove_dir_all(root).unwrap();
    let expected = [
        ("source.ts", "v1:eb4977f4fe2382e3265934f67ead6d0c"),
        ("module.d.ts", "v1:e0f1a4fa25c17d834e6580bb95bce789"),
        ("common.cts", "v1:927fd1b78635defadd6b8e2d9e6702fc"),
        ("namespace.d.ts", "v1:5c4df2f408c25cc1bd2a682e7745a53f"),
        ("bridge.d.ts", "v1:eb35e7389d2d997666bb4bc09f35bd00"),
        ("unknown.ts", "v1:007b55bef978bb3b35f0032bfec12836"),
        ("malformed.ts", "v1:59e65e30fe81cee157a0c24b19902d1b"),
    ].map(|(file, digest)| (file.to_owned(), digest.to_owned()));
    assert_eq!(observed, expected);
}
