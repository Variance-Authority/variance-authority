//! Shards of one build that describe one text two ways: one cut the module,
//! another carried a row an older writer cut.

use super::tests::{combined, files, named};
use super::*;
use crate::record_fixture::{self as fixture, block, module, spec, test};

/// A region named `name` inside region `owner`, entered by `called`.
fn inside(ordinal: u32, name: &str, owner: u32, called: &[u32]) -> fixture::Block {
    fixture::Block { name: name.to_owned(), owner, ..block(ordinal, called) }
}

/// `src/a.ts` as one build cuts it: a callback passed twice, so two regions
/// share an address, and a function after them.
fn cut_of_a() -> Vec<fixture::Block> {
    vec![block(0, &[]), inside(1, "cb", 0, &[]), inside(2, "cb", 0, &[]), inside(3, "g#0", 0, &[])]
}

/// Two shards of one build that describe `src/a.ts`, one text, two ways: `a`
/// carried a row an older writer cut without the second callback; `b` cut it.
fn disputed() -> (Vec<u8>, Vec<u8>) {
    let stale = vec![block(0, &[0]), inside(1, "cb", 0, &[0]), inside(2, "g#0", 0, &[0])];
    let fresh = vec![block(0, &[0]), inside(1, "cb", 0, &[]), inside(2, "cb", 0, &[]), inside(3, "g#0", 0, &[0])];
    let one = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", stale)]));
    let other = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", fresh)]));
    (one, other)
}

#[test]
fn names_the_modules_two_shards_describe_differently_and_writes_nothing() {
    let (one, other) = disputed();
    let combined = combined(&[&one, &other]).unwrap();
    let disputed = combined.result.disputed.expect("the fold names what it needs cut");
    assert_eq!((disputed.instrumentation.as_str(), disputed.files), ("istanbul", files(&["src/a.ts"])));
    assert!(combined.bytes.is_empty());
}

#[test]
fn folds_a_disputed_module_onto_the_build_s_own_cut_carrying_crossings_by_address() {
    let (one, other) = disputed();
    let cut = fixture::write(&spec(Vec::new(), vec![module("src/a.ts", cut_of_a())]));
    let folded = combine_bytes(&named(&[&one, &other]), Some(&cut)).unwrap();
    assert!(folded.result.disputed.is_none());
    let (tests, modules) = fixture::read(&folded.bytes);
    // `a`'s row holds the callback's address once and the cut twice, so its
    // callback names neither: `a` lends its top level and `g#0` by address,
    // takes nothing at either callback, and is owed the run that measures them.
    let regions = vec![
        (0, files(&["a.test.ts", "b.test.ts"]), Vec::new()),
        (1, Vec::new(), Vec::new()),
        (2, Vec::new(), Vec::new()),
        (3, files(&["a.test.ts", "b.test.ts"]), Vec::new()),
    ];
    assert_eq!(modules, [("src/a.ts".to_owned(), true, regions)]);
    assert_eq!(tests.iter().map(|(file, complete, _)| (file.as_str(), *complete)).collect::<Vec<_>>(), [("a.test.ts", false), ("b.test.ts", true)]);
    let reversed = combine_bytes(&named(&[&other, &one]), Some(&cut)).unwrap();
    assert_eq!(fixture::read(&reversed.bytes).1, modules, "either order folds to one description");
}

#[test]
fn owes_a_run_to_a_shard_whose_regions_have_no_place_in_the_cut() {
    let (_, other) = disputed();
    // The counters sit elsewhere: `g#1` is a seat the cut gives no region.
    let elsewhere = vec![block(0, &[0]), inside(1, "g#1", 0, &[0])];
    let one = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", elsewhere)]));
    let cut = fixture::write(&spec(Vec::new(), vec![module("src/a.ts", cut_of_a())]));
    let (tests, modules) = fixture::read(&combine_bytes(&named(&[&one, &other]), Some(&cut)).unwrap().bytes);
    assert_eq!(tests.iter().map(|(file, complete, _)| (file.as_str(), *complete)).collect::<Vec<_>>(), [("a.test.ts", false), ("b.test.ts", true)]);
    assert_eq!(modules[0].2[3], (3, files(&["b.test.ts"]), Vec::new()));
}

#[test]
fn gives_a_region_a_shard_s_row_lacks_what_that_row_measured_around_it_and_nothing_another_measured() {
    // `a`'s writer cut `g#0` without the callback inside it; `b` cut it and
    // never entered it.
    let lacking = vec![block(0, &[0]), inside(1, "g#0", 0, &[0])];
    let whole = vec![block(0, &[0]), inside(1, "g#0", 0, &[0]), inside(2, "cb", 1, &[])];
    let cut = vec![block(0, &[]), inside(1, "g#0", 0, &[]), inside(2, "cb", 1, &[])];
    let one = fixture::write(&spec(vec![test("a.test.ts")], vec![module("src/a.ts", lacking)]));
    let other = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", whole)]));
    let cut = fixture::write(&spec(Vec::new(), vec![module("src/a.ts", cut)]));
    let (tests, modules) = fixture::read(&combine_bytes(&named(&[&one, &other]), Some(&cut)).unwrap().bytes);
    assert_eq!(modules[0].2[2], (2, files(&["a.test.ts"]), Vec::new()));
    assert!(tests.iter().all(|(_, complete, _)| *complete));
}

#[test]
fn withholds_only_the_disputed_region_owing_the_tests_around_it_and_gives_a_region_the_same_row_lacks_what_it_measured_around_it() {
    // `a`'s row holds the callback once where the build cuts it twice, and
    // `g#0` without the region inside it. `d` ran the top level and `g#0`:
    // the row cannot say whether it ran the callback its writer did not cut.
    let stale = vec![block(0, &[0, 1]), inside(1, "cb", 0, &[0]), inside(2, "g#0", 0, &[0, 1])];
    let cut = || vec![block(0, &[]), inside(1, "cb", 0, &[]), inside(2, "cb", 0, &[]), inside(3, "g#0", 0, &[]), inside(4, "inner", 3, &[])];
    let one = fixture::write(&spec(vec![test("a.test.ts"), test("d.test.ts")], vec![module("src/a.ts", stale)]));
    let other = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", cut())]));
    let cut = fixture::write(&spec(Vec::new(), vec![module("src/a.ts", cut())]));
    let (tests, modules) = fixture::read(&combine_bytes(&named(&[&one, &other]), Some(&cut)).unwrap().bytes);
    assert_eq!(modules[0].2[1], (1, Vec::new(), Vec::new()));
    assert_eq!(modules[0].2[4], (4, files(&["a.test.ts", "d.test.ts"]), Vec::new()));
    let complete: Vec<_> = tests.iter().map(|(file, complete, _)| (file.as_str(), *complete)).collect();
    assert_eq!(complete, [("a.test.ts", false), ("b.test.ts", true), ("d.test.ts", false)]);
}

#[test]
fn owes_a_run_to_the_tests_around_a_branch_the_row_seated_but_did_not_cut() {
    // `t`'s writer seated both branches of `f` and cut only the second;
    // `t` ran `f`, so it may have run the first.
    let stale = vec![block(0, &[0]), inside(1, "f", 0, &[0]), inside(2, "if#1", 1, &[])];
    let cut = || vec![block(0, &[]), inside(1, "f", 0, &[]), inside(2, "if#0", 1, &[]), inside(3, "if#1", 1, &[])];
    let one = fixture::write(&spec(vec![test("t.test.ts")], vec![module("src/a.ts", stale)]));
    let other = fixture::write(&spec(vec![test("b.test.ts")], vec![module("src/a.ts", cut())]));
    let cut = fixture::write(&spec(Vec::new(), vec![module("src/a.ts", cut())]));
    let (tests, modules) = fixture::read(&combine_bytes(&named(&[&one, &other]), Some(&cut)).unwrap().bytes);
    assert_eq!(modules[0].2[2], (2, Vec::new(), Vec::new()));
    let complete: Vec<_> = tests.iter().map(|(file, complete, _)| (file.as_str(), *complete)).collect();
    assert_eq!(complete, [("b.test.ts", true), ("t.test.ts", false)]);
}

#[test]
fn refuses_a_disputed_module_the_checkout_holds_at_another_text_or_not_at_all() {
    let (one, other) = disputed();
    let mut moved = module("src/a.ts", cut_of_a());
    moved.source = "text-2";
    let cut = fixture::write(&spec(Vec::new(), vec![moved]));
    let refusal = combine_bytes(&named(&[&one, &other]), Some(&cut)).err().unwrap();
    assert!(refusal.contains("`src/a.ts` region 2 is described differently by shard-0.bin and shard-1.bin"), "{refusal}");
    assert!(refusal.contains("the checkout holds `src/a.ts` at another text"), "{refusal}");
    let none = fixture::write(&spec(Vec::new(), Vec::new()));
    let refusal = combine_bytes(&named(&[&one, &other]), Some(&none)).err().unwrap();
    assert!(refusal.contains("the checkout holds no text of `src/a.ts`"), "{refusal}");
}
