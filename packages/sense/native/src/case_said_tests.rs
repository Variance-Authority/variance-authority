use super::*;

const CASE_LEVEL: u32 = 0xffff;

fn item(name: &str, value: &str, site: &str, level: u32) -> Item {
    Item { name: name.to_owned(), value: Some(value.to_owned()), site: site.to_owned(), level }
}

fn said(items: Vec<Item>) -> Heard {
    Heard { said: Some(items), ..Heard::default() }
}

fn laid_and_read(heard: &[Option<Heard>]) -> Vec<Option<Heard>> {
    let mut pool = SetPool::new(heard.len());
    let views: Vec<Option<&Heard>> = heard.iter().map(Option::as_ref).collect();
    let sections = lay(&views, &mut pool);
    read(sections.each_ref().map(Option::as_deref), heard.len(), |set| pool.members(set)).unwrap()
}

#[test]
fn names_a_site_from_the_checkout_however_the_realm_spelled_it() {
    let root = Path::new("/repo");
    assert_eq!(checkout_site(root, "/repo/test/a.test.ts:3"), "test/a.test.ts:3");
    assert_eq!(checkout_site(root, "file:///repo/test/a%20b.test.ts:3"), "test/a b.test.ts:3");
    assert_eq!(checkout_site(root, "http://localhost:5173/@fs/repo/test/a.test.ts?v=1:3"), "test/a.test.ts:3");
    assert_eq!(checkout_site(root, "http://localhost:5173/src/a.test.ts:3"), "http://localhost:5173/src/a.test.ts:3");
    assert_eq!(checkout_site(root, "test/a.test.ts:3"), "test/a.test.ts:3");
}

#[test]
fn keeps_a_value_as_the_realm_wrote_it() {
    let field = r#"{"said":[["n:a","0.000001","a:1",65535],["s:a","\"a\\u0001\"","a:2",0]],"read":[["f:on","{\"x\":[1]}","b:1",0]]}"#;
    let heard = parse(field).unwrap();
    let said = heard.said.as_deref().unwrap();
    assert_eq!(said[0].value.as_deref(), Some("0.000001"));
    assert_eq!(said[1].value.as_deref(), Some(r#""a\u0001""#));
    assert_eq!(heard.read.as_deref().unwrap()[0].value.as_deref(), Some(r#"{"x":[1]}"#));
    assert_eq!(spell(&heard), field);
}

#[test]
fn carries_a_value_json_cannot_hold_as_unrecorded() {
    let field = r#"{"read":[["f:fn",null,"b:1",65535]]}"#;
    let heard = parse(field).unwrap();
    assert_eq!(heard.said, None, "nobody listened to what the case said");
    assert_eq!(heard.read.as_deref().unwrap()[0].value, None);
    assert_eq!(spell(&heard), field);
    assert_eq!(laid_and_read(&[Some(heard.clone())]), vec![Some(heard)]);
}

#[test]
fn reads_a_frame_that_never_listened_apart_from_one_that_heard_nothing() {
    assert_eq!(of_frame("f\0n\0i\01\0j").unwrap(), None);
    assert_eq!(of_frame("f\0n\0i\01\0j\0").unwrap(), None);
    assert_eq!(of_frame("f\0n\0i\01\0j\0{}").unwrap(), None);
    assert_eq!(of_frame(r#"f\0n\0i\01\0j\0{"said":[]}"#.replace("\\0", "\0").as_str()).unwrap(), Some(said(Vec::new())));
}

#[test]
fn joins_two_runs_to_one_answer_whichever_came_first() {
    let one = said(vec![item("n:a", "\"x\"", "b.ts:10", 1)]);
    let two = Heard {
        said: Some(vec![item("n:a", "\"x\"", "b.ts:9", 1)]),
        read: Some(vec![item("f:on", "true", "c.ts:1", 0)]),
        ..Heard::default()
    };
    let forward = join(Some(one.clone()), Some(two.clone()));
    assert_eq!(forward, join(Some(two), Some(one)));
    assert_eq!(forward.unwrap().read.unwrap().len(), 1);
    assert_eq!(join(None, None), None);
    assert_eq!(join(Some(said(Vec::new())), None), Some(said(Vec::new())));
}

#[test]
fn keeps_a_facet_unmeasured_where_only_the_other_was_listened_to() {
    let joined = join(Some(said(vec![item("n:a", "1", "a:1", 0)])), None).unwrap();
    assert_eq!(joined.read, None, "a record from before breadcrumbs read nothing it could say");
}

#[test]
fn resolves_at_read_and_keeps_what_a_narrower_level_overrode() {
    let heard = join(
        Some(said(vec![item("f:flag", "\"off\"", "a.ts:2", 0), item("f:flag", "\"on\"", "a.ts:9", CASE_LEVEL), item("net:x", "\"mocked\"", "a.ts:3", 0)])),
        None,
    )
    .unwrap();
    assert_eq!(heard.said.as_deref().unwrap().len(), 3, "the overridden value is kept");
    assert_eq!(
        resolve(&heard).said.unwrap(),
        vec![item("f:flag", "\"on\"", "a.ts:9", CASE_LEVEL), item("net:x", "\"mocked\"", "a.ts:3", 0)],
    );
}

#[test]
fn prints_a_value_said_at_several_sites_at_the_first_and_keeps_a_contradiction() {
    let heard =
        join(Some(said(vec![item("n:a", "\"x\"", "b.ts:10", 1), item("n:a", "\"x\"", "b.ts:9", 1), item("n:a", "2", "c.ts:1", 1)])), None)
            .unwrap();
    assert_eq!(resolve(&heard).said.unwrap(), vec![item("n:a", "\"x\"", "b.ts:9", 1), item("n:a", "2", "c.ts:1", 1)]);
}

#[test]
fn keeps_every_value_a_key_was_read_with_and_the_case_over_the_load() {
    let read = vec![
        item("f:on", "false", "flag.ts:4", 0),
        item("f:on", "true", "flag.ts:4", 0),
        item("f:on", "true", "flag.ts:7", CASE_LEVEL),
        item("f:on", "true", "flag.ts:9", CASE_LEVEL),
    ];
    let heard = join(Some(Heard { read: Some(read), ..Heard::default() }), None).unwrap();
    assert_eq!(
        resolve(&heard).read.unwrap(),
        vec![item("f:on", "false", "flag.ts:4", 0), item("f:on", "true", "flag.ts:7", CASE_LEVEL)],
    );
}

#[test]
fn carries_a_misused_breadcrumb_as_its_own_facet_that_no_read_holds() {
    let field = r#"{"read":[["f:on","true","flag.ts:7",65535]],"misused":[["key","7","pay.ts:9",65535]]}"#;
    let heard = parse(field).unwrap();
    assert_eq!(heard.read.as_deref().unwrap(), [item("f:on", "true", "flag.ts:7", CASE_LEVEL)], "a misuse is never a read");
    assert_eq!(heard.misused.as_deref().unwrap(), [item("key", "7", "pay.ts:9", CASE_LEVEL)]);
    assert_eq!(spell(&heard), field);
    assert_eq!(laid_and_read(&[Some(heard.clone()), None]), vec![Some(heard), None]);
}

#[test]
fn lays_no_misused_section_where_no_case_was_listened_to_for_it() {
    let mut pool = SetPool::new(1);
    let heard = Heard { said: Some(Vec::new()), read: Some(Vec::new()), ..Heard::default() };
    let [said, read, misused] = lay(&[Some(&heard)], &mut pool);
    assert!(said.is_some() && read.is_some());
    assert_eq!(misused, None, "a record that misused nothing it could say holds no section for it");
}

#[test]
fn joins_and_resolves_a_misuse_once_per_argument_and_value_at_its_narrowest_level_and_first_site() {
    let misused = vec![
        item("key", "7", "pay.ts:9", 0),
        item("key", "7", "pay.ts:12", CASE_LEVEL),
        item("key", "7", "pay.ts:9", CASE_LEVEL),
        item("dimension", "\"\"", "pay.ts:9", CASE_LEVEL),
    ];
    let one = Heard { misused: Some(misused[..2].to_vec()), ..Heard::default() };
    let two = Heard { misused: Some(misused[2..].to_vec()), ..Heard::default() };
    let joined = join(Some(one.clone()), Some(two.clone())).unwrap();
    assert_eq!(Some(&joined), join(Some(two), Some(one)).as_ref());
    assert_eq!(
        resolve(&joined).misused.unwrap(),
        vec![item("dimension", "\"\"", "pay.ts:9", CASE_LEVEL), item("key", "7", "pay.ts:9", CASE_LEVEL)],
    );
}

#[test]
fn lays_each_fact_once_and_reads_back_what_each_case_heard() {
    let shared = item("net:x", "\"mocked\"", "a.ts:3", 0);
    let heard = vec![
        Some(Heard {
            said: Some(vec![shared.clone(), item("f:flag", "true", "a.ts:9", CASE_LEVEL)]),
            read: Some(vec![shared.clone()]),
            ..Heard::default()
        }),
        None,
        Some(said(Vec::new())),
        Some(Heard { said: Some(vec![shared.clone()]), read: Some(Vec::new()), ..Heard::default() }),
    ];
    let read = laid_and_read(&heard);
    assert_eq!(read[0], join(heard[0].clone(), None));
    assert_eq!(read[1], None, "never listened to");
    assert_eq!(read[2], Some(said(Vec::new())), "listened to what it said, said nothing, reads unmeasured");
    assert_eq!(read[3], heard[3]);
}

#[test]
fn reads_an_older_record_without_reads_as_unmeasured() {
    let mut pool = SetPool::new(1);
    let [said_section, read_section, misused_section] = lay(&[Some(&said(vec![item("n:a", "1", "a:1", 0)]))], &mut pool);
    assert_eq!((read_section, misused_section), (None, None));
    let back = read([said_section.as_deref(), None, None], 1, |set| pool.members(set)).unwrap();
    assert_eq!(back[0].as_ref().unwrap().read, None);
}

#[test]
fn lays_nothing_when_no_case_was_listened_to() {
    assert_eq!(lay(&[None, None], &mut SetPool::new(2)), [None, None, None]);
}

#[test]
fn shares_a_set_the_pool_already_holds() {
    let mut pool = SetPool::new(3);
    let entered = pool.intern(&[0, 1, 2]);
    let shared = said(vec![item("net:x", "\"mocked\"", "a.ts:3", 0)]);
    let before = pool.offsets().len();
    lay(&[Some(&shared), Some(&shared), Some(&shared)], &mut pool);
    assert_eq!(pool.offsets().len(), before, "measured and the item both name set {entered}");
}

#[test]
fn refuses_a_damaged_section() {
    let mut pool = SetPool::new(1);
    let [section, ..] = lay(&[Some(&said(vec![item("n:a", "1", "a:1", 0)]))], &mut pool);
    let mut section = section.unwrap();
    section.pop();
    assert!(read([Some(&section), None, None], 1, |_| Ok(vec![0])).is_err());
}
