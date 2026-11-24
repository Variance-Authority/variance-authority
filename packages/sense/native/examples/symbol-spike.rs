use sense_native::symbol_spike::answer;

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let [root, index, help, name] = args.as_slice() else {
        return Err("usage: symbol-spike <root> <source-index> <help-store> <name>".into());
    };
    println!("{}", answer(root, index, help, name)?);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(2);
    }
}
