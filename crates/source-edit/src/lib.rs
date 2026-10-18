//! Locate JSX elements in user TSX source and apply byte-span edits to them.
//!
//! Edits are splices on the original text; the AST is never re-printed, so
//! comments and formatting outside the edited spans survive byte-for-byte.

mod apply;
mod locate;

pub use apply::{ApplyError, Edit, apply, format_number};
pub use locate::{ElementRef, element_at};

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Parses `text` as TSX. Syntax errors are tolerated; the recovered program is returned.
pub(crate) fn parse<'a>(text: &'a str, alloc: &'a Allocator) -> Program<'a> {
    Parser::new(alloc, text, SourceType::tsx()).parse().program
}
