//! A crossing declaration in a continuation: the region it opens and where its
//! probe stands. Why it opens one is in `walk.rs`, under "Functions that leave
//! the realm".

use std::fmt::Write;

use oxc_ast::ast::*;
use oxc_span::GetSpan;

use super::{Edit, Kind, Walker};

/// A crossing declaration to charge to its block: its span, the region its
/// block is entered with, and the edit at the block's start its probe joins.
#[derive(Clone, Copy)]
pub(super) struct Declared {
    pub(super) span: (u32, u32),
    pub(super) owner: u32,
    pub(super) slot: usize,
}

impl Walker {
    /// An empty edit where the block's statements start, for the probes of the
    /// crossing declarations it holds, when it holds one a branch can precede.
    ///
    /// Pushed before anything in the block is walked, so it lands in front of
    /// every other insertion at that offset — `__vaR(` opening an `await` that
    /// starts the statement among them. A module's statements start after its
    /// imports, where the header that defines `__va` is.
    pub(super) fn slot(&mut self, statements: &[Statement]) -> Option<usize> {
        if self.entries || self.crossing.is_empty() || !statements.iter().skip(1).any(|it| self.declaration(it).is_some()) {
            return None;
        }
        let at = statements.iter().find(|it| !crate::cut::is_prologue(it))?.span().start;
        let from = self.texts.len() as u32;
        self.edits.push(Edit { at, from, to: from });
        Some(self.edits.len() - 1)
    }

    /// The span of the crossing function this statement declares.
    pub(super) fn declaration(&self, statement: &Statement) -> Option<(u32, u32)> {
        let function = match statement {
            Statement::FunctionDeclaration(it) => it,
            Statement::ExportDeclaration(it) => match &it.declaration {
                Declaration::FunctionDeclaration(it) => it,
                _ => return None,
            },
            Statement::ExportDefaultDeclaration(it) => match &it.declaration {
                ExportDefaultDeclarationKind::FunctionDeclaration(it) => it,
                _ => return None,
            },
            _ => return None,
        };
        let span = (function.span.start, function.span.end);
        self.crossing.contains(&span).then_some(span)
    }

    /// Open a crossing declaration's region and add its probe to its block's slot.
    pub(super) fn hoisted(&mut self, declared: Declared, start: u32, end: u32) {
        let ordinal = self.open(Kind::Function, "entry", start, end, Some(declared.owner));
        let slot = self.edits[declared.slot];
        let from = self.texts.len() as u32;
        self.texts.extend_from_within(slot.from as usize..slot.to as usize);
        let _ = write!(self.texts, "__va({ordinal});");
        self.edits[declared.slot] = Edit { at: slot.at, from, to: self.texts.len() as u32 };
    }
}
