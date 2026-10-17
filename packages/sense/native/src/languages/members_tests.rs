use super::members;
use crate::grammar::{self, Grammar};

/// `name on line` for every member the reader of `grammar` records in `source`.
fn read(grammar: Grammar, source: &str) -> Vec<String> {
    let tree = grammar::parse(grammar, source).expect("parses");
    members(grammar, &tree, source).into_iter().map(|one| format!("{} on {} at {}", one.name, one.on, one.line)).collect()
}

#[test]
fn a_rust_type_holds_its_fields_variants_and_the_items_of_its_impls_and_traits() {
    let source = [
        "pub struct Bound { pub width: u32, height: u32 }",
        "enum Shape { Round, Square(u8) }",
        "impl<'a> Wrapper<'a> { pub fn same(&self) -> bool { true } const LIMIT: u8 = 1; type Item = u8; }",
        "impl Charged for outer::Held<u8> { fn charge(&mut self) {} }",
        "trait Charged { fn charge(&mut self); fn twice(&self) {} type Unit; const RATE: u8; }",
        "mod inner { impl Bound { fn inside() {} } }",
        "fn local() { struct Kept { kept: u8 } }",
        "struct Pair(u8, u8);",
    ]
    .join("\n");
    assert_eq!(
        read(Grammar::Rust, &source),
        [
            "width on Bound at 1", "height on Bound at 1",
            "Round on Shape at 2", "Square on Shape at 2",
            "same on Wrapper at 3", "LIMIT on Wrapper at 3", "Item on Wrapper at 3",
            "charge on Held at 4",
            "charge on Charged at 5", "twice on Charged at 5", "Unit on Charged at 5", "RATE on Charged at 5",
            "inside on Bound at 6",
            "kept on Kept at 7",
        ]
    );
}

#[test]
fn a_java_type_holds_its_fields_methods_constants_and_components_and_not_its_constructor() {
    let source = [
        "class Agent {",
        "  private int first, second;",
        "  Agent() {}",
        "  void run() {}",
        "  enum Mode { ONE, TWO; void flip() {} }",
        "  interface Hook { void call(); int LIMIT = 1; }",
        "  record Point(int x) { void shift() {} }",
        "}",
    ]
    .join("\n");
    assert_eq!(
        read(Grammar::Java, &source),
        [
            "first on Agent at 2", "second on Agent at 2", "run on Agent at 4",
            "ONE on Mode at 5", "TWO on Mode at 5", "flip on Mode at 5",
            "call on Hook at 6", "LIMIT on Hook at 6",
            "x on Point at 7", "shift on Point at 7",
        ]
    );
}

#[test]
fn a_kotlin_type_holds_its_properties_functions_and_entries() {
    let source = [
        "class Agent(val held: Int, passed: Int) {",
        "    val count = 1",
        "    fun run() {}",
        "    companion object {",
        "        fun make() {}",
        "    }",
        "}",
        "interface Hook {",
        "    fun call()",
        "}",
        "object Registry {",
        "    fun find() {}",
        "}",
        "enum class Mode {",
        "    ONE, TWO",
        "}",
    ]
    .join("\n");
    assert_eq!(
        read(Grammar::Kotlin, &source),
        [
            "held on Agent at 1", "count on Agent at 2", "run on Agent at 3",
            "make on a companion object at 5",
            "call on Hook at 9", "find on Registry at 12",
            "ONE on Mode at 15", "TWO on Mode at 15",
        ]
    );
}

#[test]
fn a_swift_type_holds_its_properties_functions_cases_and_what_an_extension_adds() {
    let source = [
        "struct Agent {",
        "    var held: Int",
        "    let count = 1",
        "    func run() {}",
        "    init() {}",
        "}",
        "protocol Hook {",
        "    func call()",
        "    var limit: Int { get }",
        "}",
        "extension Agent {",
        "    func added() {}",
        "}",
        "enum Mode {",
        "    case one, two",
        "}",
    ]
    .join("\n");
    assert_eq!(
        read(Grammar::Swift, &source),
        [
            "held on Agent at 2", "count on Agent at 3", "run on Agent at 4",
            "call on Hook at 8", "limit on Hook at 9",
            "added on Agent at 12",
            "one on Mode at 15", "two on Mode at 15",
        ]
    );
}

#[test]
fn a_python_class_holds_its_attributes_and_methods() {
    let source = [
        "class Agent:",
        "    count = 1",
        "    limit: int = 2",
        "    def run(self):",
        "        self.ran = True",
        "    @property",
        "    def held(self):",
        "        pass",
        "    class Inner:",
        "        def call(self):",
        "            pass",
    ]
    .join("\n");
    assert_eq!(
        read(Grammar::Python, &source),
        ["count on Agent at 2", "limit on Agent at 3", "run on Agent at 4", "held on Agent at 7", "call on Inner at 10"]
    );
}
