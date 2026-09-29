use super::*;

fn call<'p>(parsed: &'p Parsed, name: &str) -> &'p Call {
    parsed
        .calls
        .iter()
        .find(|call| !call.by_ref && call.callback.is_none() && (call.callee.id.as_deref() == Some(name) || call.callee.prop.as_deref() == Some(name)))
        .unwrap_or_else(|| panic!("no call to {name}"))
}

#[test]
fn a_guard_counts_branches_and_statements_after_an_early_exit() {
    let parsed = parse(
        "a.ts",
        "function f(x) {\n  first();\n  if (x) return;\n  second();\n  x && third();\n  switch (x) { case 1: fourth(); }\n  try { fifth() } catch { sixth() }\n  for (;;) { seventh() }\n  x?.();\n}\n",
    )
    .unwrap();
    assert_eq!(call(&parsed, "first").guard, 0);
    assert_eq!(call(&parsed, "second").guard, 1);
    assert_eq!(call(&parsed, "third").guard, 2);
    assert_eq!(call(&parsed, "fourth").guard, 2);
    assert_eq!(call(&parsed, "fifth").guard, 1);
    assert_eq!(call(&parsed, "sixth").guard, 2);
    assert_eq!(call(&parsed, "seventh").guard, 1);
    assert_eq!(call(&parsed, "x").guard, 2);
}

#[test]
fn a_function_is_named_by_its_binding_key_or_the_call_it_is_handed_to() {
    let parsed = parse(
        "a.test.ts",
        "const a = () => {};\nconst o = { b() {}, c: function () {} };\nclass K { d() {} e = () => {} }\ndescribe('suite', () => {\n  it(`adds ${1} and`, async () => { a(); });\n});\n",
    )
    .unwrap();
    let hints: Vec<_> = parsed.fns.iter().map(|func| func.hint.as_deref().unwrap_or("-")).collect();
    assert_eq!(hints, ["a", "b", "c", "d", "e", "describe.arg1", "it.arg1"]);
    assert_eq!(parsed.fns[5].title.as_deref(), Some("suite"));
    assert_eq!(parsed.fns[6].title.as_deref(), Some("adds * and"));
    assert_eq!(parsed.fns[6].parent, Some(5));
    // The body is a callback of the call carrying it, which sorts just before that call.
    let handed = parsed.calls.iter().find(|call| call.callback == Some(6)).unwrap();
    assert_eq!((handed.from, handed.line), (Some(5), 5));
    assert_eq!(handed.col + 2, call(&parsed, "it").col);
    assert_eq!(parsed.locals.get("a"), Some(&vec![0]));
    assert!(!parsed.locals.contains_key("it.arg1"));
    assert!(parsed.decls.contains_key("o") && parsed.decls.contains_key("K") && !parsed.decls.contains_key("a"));
}

#[test]
fn a_value_made_by_a_factory_names_the_factory_and_a_reference_is_a_call() {
    let parsed = parse(
        "a.tsx",
        "import { styled } from './s';\nimport * as core from './core';\nexport const Root = styled(Base)({});\nexport default core.make(1);\nfunction g(this: X, a, b = 1, { c }, ...rest) { list.map(g); return <Root /> }\nexport * from './all';\nexport { h as i } from './h';\n",
    )
    .unwrap();
    assert_eq!(parsed.decls["Root"].made.as_ref().and_then(|made| made.id.as_deref()), Some("styled"));
    let default = parsed.decls["default"].made.as_ref().unwrap();
    assert_eq!((default.ns.as_deref(), default.prop.as_deref()), (Some("core"), Some("make")));
    assert_eq!(parsed.fns[0].params, [Some("this".to_owned()), Some("a".to_owned()), Some("b".to_owned()), None, None]);
    let reference = parsed.calls.iter().find(|call| call.by_ref && call.from.is_some()).unwrap();
    assert_eq!(reference.callee.id.as_deref(), Some("g"));
    // A function passed by name sorts just before the call it is passed to.
    assert_eq!(reference.col + 1, call(&parsed, "map").col);
    assert!(parsed.calls.iter().any(|call| call.callee.id.as_deref() == Some("Root")));
    assert_eq!(parsed.imports["core"].name, "*");
    assert_eq!(parsed.star, ["./all"]);
    assert!(matches!(&parsed.exports["i"], Export::From { spec, name } if spec == "./h" && name == "h"));
    assert!(matches!(&parsed.exports["Root"], Export::Local(local) if local == "Root"));
}
