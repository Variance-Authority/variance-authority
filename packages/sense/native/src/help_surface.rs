//! How an answer names an input or a question on the surface it was asked on.
//!
//! The native half of `packages/mcp/src/tools/spelling.ts`: a shell is named by
//! the words that ask from it, and a wire host names none. Both halves are held
//! to `packages/mcp/src/tools/spelling-cases.json`.

// compass: variance-authority.report.agent-surface

/// A value as its schema types it.
#[derive(Clone, Copy)]
pub(crate) enum Value<'a> {
    Text(&'a str),
    List(&'a [&'a str]),
}

/// The words that ask a question from the shell `variance` runs in.
pub(crate) const CLI: &str = "variance ask";

#[derive(Clone, Copy)]
pub(crate) struct Surface<'a>(pub Option<&'a str>);

impl Surface<'_> {
    pub(crate) fn input(self, property: &str) -> String {
        if self.0.is_some() { flag(property) } else { property.to_owned() }
    }

    /// A question in backticks: `verb` with its inputs, in order.
    pub(crate) fn question(self, verb: &str, inputs: &[(&str, Value)]) -> String {
        let Some(asked) = self.0 else {
            let with = inputs.iter().map(|(property, value)| format!("`{property}` `{}`", wired(*value))).collect::<Vec<_>>();
            return format!("`docs_{verb}` with {}", with.join(" and "));
        };
        format!("`{}`", typed(asked, verb, inputs))
    }
}

/// A question as the words a shell takes, with no backticks: `asked`, then `verb` with its inputs, in order.
pub(crate) fn typed(asked: &str, verb: &str, inputs: &[(&str, Value)]) -> String {
    let flags = inputs.iter().map(|(property, value)| {
        let said = match value {
            Value::Text(text) => (*text).to_owned(),
            Value::List(values) => values.join(","),
        };
        // A value a flag parser would read as the next flag is joined to its own.
        let joint = if said.starts_with('-') { '=' } else { ' ' };
        format!(" {}{joint}{}", flag(property), shell(&said))
    });
    format!("{asked} {verb}{}", flags.collect::<String>())
}

fn flag(property: &str) -> String {
    let mut written = String::from("--");
    for letter in property.chars() {
        if letter.is_ascii_uppercase() {
            written.push('-');
        }
        written.push(letter.to_ascii_lowercase());
    }
    written
}

fn wired(value: Value) -> String {
    match value {
        Value::Text(text) => text.to_owned(),
        Value::List(values) => serde_json::json!(values).to_string(),
    }
}

/// A value as one shell word: quoted only when a word would not survive.
pub(crate) fn shell(value: &str) -> String {
    let plain = |byte: u8| byte.is_ascii_alphanumeric() || b"_./:@,+=%#-".contains(&byte);
    if !value.is_empty() && !value.starts_with(['#', '=']) && value.bytes().all(plain) {
        value.to_owned()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

#[cfg(test)]
#[path = "help_surface_tests.rs"]
mod tests;
