//! The regions a decision opens: an `if`, a `switch`, a `try` and a loop.
//!
//! Each returns the label its statement was numbered under, which the list that
//! holds the statement extends into the `…/after` region that follows it. The
//! entries walk declines every one of these, so nothing here runs under it.

use oxc_ast::ast::*;
use oxc_ast_visit::Visit;
use oxc_span::GetSpan;

use super::{Kind, Walker};

impl Walker {
    pub(super) fn branch(&mut self, it: &IfStatement) -> String {
        let label = self.step("if");
        self.visit_expression(&it.test);
        self.region(&it.consequent, Kind::Branch, &format!("{label}/then"));

        match &it.alternate {
            None => {
                let end = it.consequent.span().end;
                let owner = self.owner;
                let ordinal = self.open(Kind::Branch, &format!("{label}/else"), end, end, Some(owner));
                self.push(end, format_args!(" else{{__va({ordinal});}}"));
            }
            Some(alternate) => self.region(alternate, Kind::Branch, &format!("{label}/else")),
        }
        label
    }

    pub(super) fn switched(&mut self, it: &SwitchStatement) -> String {
        let label = self.step("switch");
        let owner = self.owner;
        let path = self.path.clone();
        let mut written = false;

        self.visit_expression(&it.discriminant);

        for (index, clause) in it.cases.iter().enumerate() {
            let step = match clause.test {
                None => format!("{label}/default"),
                Some(_) => format!("{label}/case#{index}"),
            };
            written |= clause.test.is_none();

            let head = clause.consequent.first().map_or(clause.span.end, |s| s.span().start);
            let ordinal = self.open(Kind::Case, &step, head, clause.span.end, Some(owner));
            self.hit(head, ordinal);

            if let Some(test) = &clause.test {
                self.at(&path, owner, |w| w.visit_expression(test));
            }
            self.list(&clause.consequent, &step, ordinal);
        }

        if !written {
            let at = it.span.end - 1;
            let ordinal = self.open(Kind::Case, &format!("{label}/default"), at, at, Some(owner));
            // The last case's last statement may end at the `}` with no
            // semicolon, as minified code writes it: `return 1default:` is not
            // a program. With no case there is no statement to end, and a bare
            // `;` is not a clause.
            let separator = if it.cases.is_empty() { "" } else { ";" };
            self.push(at, format_args!("{separator}default:__va({ordinal});"));
        }
        label
    }

    pub(super) fn guarded(&mut self, it: &TryStatement) -> String {
        let label = self.step("try");
        let owner = self.owner;

        self.list(&it.block.body, &format!("{label}/try"), owner);

        if let Some(handler) = &it.handler {
            if let Some(param) = &handler.param {
                self.visit_catch_parameter(param);
            }
            let path = format!("{label}/catch");
            let (caught, _) = self.enter((handler.body.span.start, handler.body.span.end), true, Kind::Handler, &path);
            self.list(&handler.body.body, &path, caught);
        }

        if let Some(finalizer) = &it.finalizer {
            let path = format!("{label}/finally");
            let (finished, _) = self.enter((finalizer.span.start, finalizer.span.end), true, Kind::Handler, &path);
            self.list(&finalizer.body, &path, finished);
        }
        label
    }

    /// `init`, `test`, `update`, `left`, `right`, in that order, then the body.
    pub(super) fn looped(&mut self, statement: &Statement) -> String {
        let (word, body) = match statement {
            Statement::ForStatement(it) => ("for", &it.body),
            Statement::ForInStatement(it) => ("for", &it.body),
            Statement::ForOfStatement(it) => ("for", &it.body),
            Statement::WhileStatement(it) => ("while", &it.body),
            Statement::DoWhileStatement(it) => ("while", &it.body),
            _ => unreachable!("only loops reach here"),
        };
        let label = self.step(word);

        match statement {
            Statement::ForStatement(it) => {
                if let Some(init) = &it.init {
                    self.visit_for_statement_init(init);
                }
                if let Some(test) = &it.test {
                    self.visit_expression(test);
                }
                if let Some(update) = &it.update {
                    self.visit_expression(update);
                }
            }
            Statement::ForInStatement(it) => {
                self.visit_for_statement_left(&it.left);
                self.visit_expression(&it.right);
            }
            Statement::ForOfStatement(it) => {
                self.visit_for_statement_left(&it.left);
                self.visit_expression(&it.right);
            }
            Statement::WhileStatement(it) => self.visit_expression(&it.test),
            Statement::DoWhileStatement(it) => self.visit_expression(&it.test),
            _ => {}
        }

        self.region(body, Kind::Loop, &format!("{label}/body"));
        label
    }
}
