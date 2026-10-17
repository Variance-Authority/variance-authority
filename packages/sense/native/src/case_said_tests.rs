use super::*;

const CASE_LEVEL: u32 = 0xffff;

fn item(name: &str, value: &str, site: &str, level: u32) -> Item {
    Item { name: name.to_owned(), value: value.to_owned(), site: site.to_owned(), level }
}

fn laid_and_read(said: &[Option<Vec<Item>>]) -> Vec<Option<Said>> {
    let mut pool = SetPool::new(said.len());
    let views: Vec<Option<&[Item]>> = said.iter().map(Option::as_deref).collect();
    let section = lay(&views, &mut pool).expect("a case was listened to");
    read(&section, said.len(), |set| pool.members(set)).unwrap()
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
    let field = r#"[["n",0.000001,"a:1",65535],["s","a\u0001","a:2",0],["t",true,"a:3",1]]"#;
    let items = parse(field).unwrap();
    assert_eq!(items[0].value, "0.000001");
    assert_eq!(items[1].value, r#""a\u0001""#);
    assert_eq!(spell(&items), field);
}

#[test]
fn reads_a_frame_that_never_listened_apart_from_one_that_said_nothing() {
    assert_eq!(of_frame("f\0n\0i\01\0j").unwrap(), None);
    assert_eq!(of_frame("f\0n\0i\01\0j\0").unwrap(), None);
    assert_eq!(of_frame("f\0n\0i\01\0j\0[]").unwrap(), Some(Vec::new()));
}

#[test]
fn joins_two_runs_to_one_answer_whichever_came_first() {
    let one = vec![item("n", "\"x\"", "b.ts:10", 1)];
    let two = vec![item("n", "\"x\"", "b.ts:9", 1), item("n", "\"x\"", "c.ts:1", 1)];
    let forward = join(Some(one.clone()), Some(two.clone()));
    assert_eq!(forward, join(Some(two), Some(one)));
    assert_eq!(join(None, None), None);
    assert_eq!(join(Some(Vec::new()), None), Some(Vec::new()));
}

#[test]
fn resolves_at_read_and_keeps_what_a_narrower_level_overrode() {
    let said = join(
        Some(vec![item("flag", "\"off\"", "a.ts:2", 0), item("flag", "\"on\"", "a.ts:9", CASE_LEVEL), item("net", "\"mocked\"", "a.ts:3", 0)]),
        None,
    )
    .unwrap();
    assert_eq!(said.len(), 3, "the overridden value is kept");
    assert_eq!(resolve(&said), vec![item("flag", "\"on\"", "a.ts:9", CASE_LEVEL), item("net", "\"mocked\"", "a.ts:3", 0)]);
}

#[test]
fn prints_a_value_said_at_several_sites_at_the_first_and_keeps_a_contradiction() {
    let said = join(
        Some(vec![item("n", "\"x\"", "b.ts:10", 1), item("n", "\"x\"", "b.ts:9", 1), item("n", "2", "c.ts:1", 1)]),
        None,
    )
    .unwrap();
    assert_eq!(resolve(&said), vec![item("n", "\"x\"", "b.ts:9", 1), item("n", "2", "c.ts:1", 1)]);
}

#[test]
fn lays_each_fact_once_and_reads_back_what_each_case_said() {
    let shared = item("net", "\"mocked\"", "a.ts:3", 0);
    let said = vec![
        Some(vec![shared.clone(), item("flag", "true", "a.ts:9", CASE_LEVEL)]),
        None,
        Some(Vec::new()),
        Some(vec![shared.clone()]),
    ];
    let read = laid_and_read(&said);
    assert_eq!(read[0], join(said[0].clone(), None));
    assert_eq!(read[1], None, "never listened to");
    assert_eq!(read[2], Some(Vec::new()), "listened to, said nothing");
    assert_eq!(read[3], Some(vec![shared]));
}

#[test]
fn lays_nothing_when_no_case_was_listened_to() {
    assert_eq!(lay(&[None, None], &mut SetPool::new(2)), None);
}

#[test]
fn shares_a_set_the_pool_already_holds() {
    let mut pool = SetPool::new(3);
    let entered = pool.intern(&[0, 1, 2]);
    let shared = item("net", "\"mocked\"", "a.ts:3", 0);
    let said = [Some(std::slice::from_ref(&shared)), Some(std::slice::from_ref(&shared)), Some(std::slice::from_ref(&shared))];
    let before = pool.offsets().len();
    lay(&said, &mut pool).unwrap();
    assert_eq!(pool.offsets().len(), before, "measured and the item both name set {entered}");
}

#[test]
fn refuses_a_damaged_section() {
    let mut pool = SetPool::new(1);
    let mut section = lay(&[Some(&[item("n", "1", "a:1", 0)][..])], &mut pool).unwrap();
    section.pop();
    assert!(read(&section, 1, |_| Ok(vec![0])).is_err());
}
