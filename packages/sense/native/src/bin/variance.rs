use std::ffi::OsString;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::{self, Command};

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if let Some((status, error)) = sense_native::cli::index_answer(
        &args,
        |note| {
            let _ = io::stderr().lock().write_all(note.as_bytes());
        },
        |report| {
            write_answer(io::stdout().lock(), report);
        },
    ) {
        if !error.is_empty() {
            write_answer(io::stderr().lock(), &format!("{error}{}", skill_line()));
        }
        process::exit(status);
    }
    if let Some((status, mut text)) = sense_native::cli::answer(&args, |note| {
        let _ = io::stderr().lock().write_all(note.as_bytes());
    }) {
        if status != 0 {
            text.push_str(&skill_line());
        }
        if status == 0 {
            write_answer(io::stdout().lock(), &text);
        } else {
            write_answer(io::stderr().lock(), &text);
        }
        process::exit(status);
    }
    if let Err(error) = forward(&args) {
        eprintln!("variance: {error}");
        process::exit(127);
    }
}

fn write_answer(mut output: impl Write, text: &str) {
    if let Err(error) = output.write_all(text.as_bytes()) {
        if error.kind() != io::ErrorKind::BrokenPipe {
            eprintln!("variance: {error}");
            process::exit(1);
        }
    }
}

fn skill_line() -> String {
    let skill = || -> Option<PathBuf> {
        let dist = cli_dist().ok()?;
        let package = dist.parent()?;
        let at = package.join("skills/variance-authority/SKILL.md");
        at.is_file().then_some(at)
    };
    let Some(skill) = skill() else { return String::new() };
    let cwd = std::env::current_dir().ok();
    let shown = cwd
        .as_ref()
        .and_then(|cwd| skill.strip_prefix(cwd).ok())
        .filter(|near| !near.as_os_str().is_empty())
        .unwrap_or(&skill);
    format!("\nSee the skill at {}\n", shown.display())
}

fn forward(args: &[OsString]) -> io::Result<()> {
    let companion = cli_dist()?.join("bin.js");
    let mut node = Command::new("node");
    node.arg(companion).args(args);
    hand_off(node)
}

fn cli_dist() -> io::Result<PathBuf> {
    let executable = std::env::current_exe()?.canonicalize()?;
    executable.parent().map(ToOwned::to_owned).ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
}

#[cfg(unix)]
fn hand_off(mut node: Command) -> io::Result<()> {
    use std::os::unix::process::CommandExt;
    Err(node.exec())
}

#[cfg(not(unix))]
fn hand_off(mut node: Command) -> io::Result<()> {
    let status = node.status()?;
    process::exit(status.code().unwrap_or(1));
}
