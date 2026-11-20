// A binary an integration test launches, as `CARGO_BIN_EXE_calc` names it.
fn doubled(a: i32) -> i32 {
    calc::add(a, a)
}

fn main() {
    // Leaves its profile cut short, as a process killed while writing it does.
    if std::env::args().nth(1).as_deref() == Some("abort") {
        let profile = std::env::var("LLVM_PROFILE_FILE").expect("a profile path").replace("%p", &std::process::id().to_string());
        std::fs::write(profile, b"").expect("the profile is written");
        std::process::abort();
    }
    println!("{}", doubled(21));
}
