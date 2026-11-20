// A build script runs at build time, instrumented like the rest of the crate,
// and names a file it reads, which no test does.
fn main() {
    println!("cargo::rerun-if-changed=schema.txt");
}
