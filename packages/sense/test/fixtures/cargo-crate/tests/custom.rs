// A harness of its own, which refuses libtest's arguments as some do.
fn main() {
    if std::env::args().len() > 1 {
        std::process::exit(2);
    }
    assert_eq!(calc::add(2, 2), 4);
}
