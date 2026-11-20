// A binary an integration test launches, as `CARGO_BIN_EXE_calc` names it.
fn doubled(a: i32) -> i32 {
    calc::add(a, a)
}

fn main() {
    println!("{}", doubled(21));
}
