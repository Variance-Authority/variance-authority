// A binary an integration test launches, as `CARGO_BIN_EXE_calc` names it.
fn doubled(a: i32) -> i32 {
    calc::add(a, a)
}

fn main() {
    // Leaves before the profile runtime would write its counters at exit.
    if std::env::args().nth(1).as_deref() == Some("abort") {
        std::process::abort();
    }
    println!("{}", doubled(21));
}
