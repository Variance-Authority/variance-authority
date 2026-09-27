//! JavaScript's rows join the closure's without displacing them.

use super::merged;
use crate::generation::Delta;
use crate::record::Indexed;

#[test]
fn the_closure_wins_a_file_both_name() {
    let delta: Delta = serde_json::from_str(
        r#"{"directories":[],"parses":[],"records":[
            ["b.css",{"record":{"file":"b.css"},"witnesses":[]}],
            ["a.ts",{"record":{"file":"a.ts","unknown":"stale"},"witnesses":[]}]]}"#,
    )
    .unwrap();
    let closure: Vec<Indexed> =
        serde_json::from_str(r#"[{"record":{"file":"a.ts","digest":"git:a"},"witnesses":[],"targets":[]}]"#).unwrap();
    let bytes = merged(&closure, &delta);
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("git:a"));
    assert!(!text.contains("stale"));
    assert!(text.contains("b.css"));
}
