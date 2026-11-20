// A build script that names nothing it reads: Cargo then runs it again on a
// change to any file of the package, such as `limits.txt` or `schema.rs`.
fn main() {
    let _ = std::fs::read_to_string("limits.txt");
    let _ = std::fs::read_to_string("schema.rs");
}
