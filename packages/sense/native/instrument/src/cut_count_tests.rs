use super::*;

#[test]
fn counting_keeps_the_cuts_regions_without_building_its_output() {
    let sources = [
        ("", "a.ts"),
        ("// only a comment\n", "a.ts"),
        ("export function f(x) { if (x) return 1; return 0 }", "a.js"),
        ("async function f(x = () => 1, { y } = read()) { await x(); if (y) await x(); else for (const v of y) x(v); return () => y }", "a.ts"),
        ("switch (await key) { case 1: if (x) break; default: try { f() } catch (e) { g(e) } finally { done() } }", "a.ts"),
        ("switch (x) { case 0: break; case 1: } while (x) { x--; } do x++; while (x);", "a.js"),
        ("export function f(page, x) { page.evaluate(probe); if (x) return; function probe() { return () => 1 } }", "a.ts"),
        ("outer: switch (await page.kind) { case 1: page.evaluate(probe); break outer; default: function probe() { return 1 } }", "a.ts"),
        ("page.evaluate((() => 1) as () => number); [() => 2]; export abstract class A { abstract f(x: number): void; method(x = () => 1) { return x() } }", "a.ts"),
        ("const C = class { static { if (x) f(); } field = async (x = () => 1) => await x(); ['m']() { return <b />; } };", "a.tsx"),
    ];
    for (source, file) in sources {
        let allocator = Allocator::new();
        let source_type = dialect(file).expect("a known dialect");
        let parsed = Parser::new(&allocator, source, source_type).parse();
        assert!(parsed.diagnostics.is_empty(), "{source}");
        let counted = walk_counting(&parsed.program, source_type.is_typescript());
        let cut = cut(source, file, false).expect("the instrument cuts it");
        assert_eq!(counted.source_regions, cut.blocks.iter().filter(|block| block.end > block.start).count() as u32, "{source}");
        assert!(counted.blocks.is_empty(), "counting emits no named regions: {source}");
        assert!(counted.edits.is_empty(), "counting emits no probes: {source}");
        assert!(counted.texts.is_empty(), "counting emits no captures or wrappers: {source}");
    }
}
