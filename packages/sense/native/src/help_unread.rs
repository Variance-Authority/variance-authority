//! Why a name question's answer did not read: said to the asker, never
//! handed to another reading, and never mistaken for an index not published.

// compass: variance-authority.report.agent-surface

/// The reason a read the help store or the source index should hold came back empty.
pub(crate) const STORE: &str = "the help store or the source index holds a row this reading cannot read";

/// An answer that needed `reason` and found nothing, said rather than dropped.
pub(crate) trait Said<T> {
    fn said(self, reason: &str) -> Result<T, String>;
}

impl<T> Said<T> for Option<T> {
    fn said(self, reason: &str) -> Result<T, String> {
        self.ok_or_else(|| reason.to_owned())
    }
}

/// The sentence a name question prints when its answer did not read: the question and why.
pub(crate) fn not_answered(question: &str, why: &str) -> String {
    format!("{question} could not be answered from the published source index: {why}.")
}

/// Why the `uses` question `asking` holds was not answered, the question said
/// with every input it was asked with.
pub(crate) fn uses_not_answered(asking: &crate::help_uses_answer::Asking<'_>, why: &str) -> String {
    use crate::help_surface::Value;
    let limit = asking.limit.map(|limit| limit.to_string());
    let inputs: Vec<_> = [("name", Some(asking.name)), ("package", asking.wanted), ("from", asking.from), ("file", asking.file), ("limit", limit.as_deref())]
        .into_iter()
        .filter_map(|(property, value)| value.map(|value| (property, Value::Text(value))))
        .collect();
    not_answered(&asking.surface.question("uses", &inputs), why)
}
