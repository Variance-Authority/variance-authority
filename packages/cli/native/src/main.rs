use std::ffi::OsString;
use std::io::{self, Write};
use std::process::{self, Command};

include!(env!("VARIANCE_CLI_RESPONSES"));

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    // A package-manager launch can add a direct-call hint. Its existing owner
    // handles that environment along with commands outside the response table.
    if std::env::var_os("npm_config_user_agent").is_none_or(|agent| agent.is_empty()) {
        for (command, response) in RESPONSES {
            if args.iter().eq(command.iter().copied()) {
                if let Err(error) = io::stdout().lock().write_all(response) {
                    if error.kind() != io::ErrorKind::BrokenPipe {
                        refuse(error, 1);
                    }
                }
                return;
            }
        }
    }
    if let Err(error) = forward(&args) {
        refuse(error, 127);
    }
}

fn forward(args: &[OsString]) -> io::Result<()> {
    let companion = std::env::current_exe()?.with_file_name("bin.js");
    let mut node = Command::new("node");
    node.arg(companion).args(args);
    hand_off(node)
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

fn refuse(error: io::Error, status: i32) -> ! {
    eprintln!("variance: {error}");
    process::exit(status);
}
