//! A crossing declaration whose text control can skip: the region it opens and
//! where its probe stands. Why it opens one is in `walk.rs`, under "Functions
//! that leave the realm".

use std::fmt::Write;

use oxc_ast::ast::*;
use oxc_span::GetSpan;

use super::{Edit, Kind, Walker};

/// Where the crossing declarations of one block are charged: the region the
/// block is entered with, the edit their probes join, and what ends each probe
/// there — `;` among statements, `,` in a `switch`'s discriminant.
#[derive(Clone, Copy)]
pub(super) struct Slot {
    pub(super) owner: u32,
    pub(super) edit: usize,
    pub(super) after: char,
}

/// A crossing declaration to charge to its block, by span.
#[derive(Clone, Copy)]
pub(super) struct Declared {
    pub(super) span: (u32, u32),
    pub(super) slot: Slot,
}

impl Walker {
    /// An empty edit where the block's statements start, for the probes of the
    /// crossing declarations it holds, when it holds one a branch can precede.
    ///
    /// Pushed before anything in the block is walked, so it lands in front of
    /// every other insertion at that offset — `__vaR(` opening an `await` that
    /// starts the statement among them. A module's statements start after its
    /// imports, where the header that defines `__va` is.
    pub(super) fn slot(&mut self, statements: &[Statement], owner: u32) -> Option<Slot> {
        if self.entries || self.crossing.is_empty() || !statements.iter().skip(1).any(|it| self.declaration(it).is_some()) {
            return None;
        }
        let at = statements.iter().find(|it| !crate::cut::is_prologue(it))?.span().start;
        Some(Slot { owner, edit: self.reserve(at), after: ';' })
    }

    /// The slot for a `switch` whose cases declare a crossing function.
    ///
    /// Every case is one block, entered once the discriminant is read and
    /// before a case is chosen, so a declaration under one case exists in all
    /// of them. Its probe opens the discriminant, `switch (__va(k),x)`, where
    /// the region the `switch` is reached in still holds; pushed before the
    /// discriminant is walked, it lands in front of an `await` there.
    pub(super) fn cased(&mut self, it: &SwitchStatement) -> Option<Slot> {
        let declares = it.cases.iter().flat_map(|clause| &clause.consequent).any(|it| self.declaration(it).is_some());
        if self.crossing.is_empty() || !declares {
            return None;
        }
        Some(Slot { owner: self.owner, edit: self.reserve(it.discriminant.span().start), after: ',' })
    }

    fn reserve(&mut self, at: u32) -> usize {
        let from = self.texts.len() as u32;
        self.edits.push(Edit { at, from, to: from });
        self.edits.len() - 1
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
    pub(super) fn hoisted(&mut self, slot: Slot, start: u32, end: u32) {
        let ordinal = self.open(Kind::Function, "entry", start, end, Some(slot.owner));
        let edit = self.edits[slot.edit];
        let from = self.texts.len() as u32;
        self.texts.extend_from_within(edit.from as usize..edit.to as usize);
        let probe = self.probe(ordinal);
        let _ = write!(self.texts, "{probe}{}", slot.after);
        self.edits[slot.edit] = Edit { at: edit.at, from, to: self.texts.len() as u32 };
    }
}
