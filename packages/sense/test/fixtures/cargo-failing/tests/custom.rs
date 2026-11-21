// Fails when run as `cargo test` runs it, with no arguments.
fn main() {
    if std::env::args().len() > 1 {
        std::process::exit(2);
    }
    println!("custom harness: half(5) is {}", failing::half(5));
    std::process::exit(1);
}
