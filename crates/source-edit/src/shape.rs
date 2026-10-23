//! Expressions reduced to the shapes the resolve rules tell apart.

use oxc_ast::ast::{
    BinaryOperator, CallExpression, Expression, ObjectPropertyKind, StringLiteral, UnaryOperator,
};
use oxc_span::GetSpan;

use crate::resolve::{LiteralForm, Span};

/// An attribute value or initializer, reduced to what the rules need.
#[derive(Debug)]
pub(crate) enum Shape {
    Number(Span, f64),
    String(Span, String, LiteralForm),
    Bool(Span, bool, LiteralForm),
    Interpolate(Interpolate),
    Call(String),
    Ident(String),
    Other(Span),
}

/// An `interpolate(input, inputRange, outputRange, ...)` call whose ranges
/// are kept only when they are arrays of numeric literals.
#[derive(Debug)]
pub(crate) struct Interpolate {
    /// The whole call, reported when it is not editable.
    pub(crate) call: Span,
    pub(crate) input: Input,
    pub(crate) input_range: Option<Vec<f64>>,
    pub(crate) output_range: Option<Vec<(Span, f64)>>,
    /// A fourth (`options`) argument is written: easing or extrapolation
    /// may change the value between and outside the keyframes.
    pub(crate) has_options: bool,
    /// The value at each `inputRange` entry is its `outputRange` entry: the
    /// easing is absent or a named `Easings` member, so it gives 0 and 1 at
    /// the ends of a segment. A hand-written one may not
    /// (`t => t === 0 ? 0.5 : t`).
    pub(crate) keyframes_exact: bool,
}

#[derive(Debug)]
pub(crate) enum Input {
    /// `name`, or `name - offset`.
    Frame {
        name: String,
        offset: f64,
    },
    Other,
}

pub(crate) fn shape_of(expr: &Expression<'_>) -> Shape {
    match expr.without_parentheses() {
        Expression::NumericLiteral(n) => Shape::Number(
            Span {
                start: n.span.start,
                end: n.span.end,
            },
            n.value,
        ),
        Expression::UnaryExpression(u) if u.operator == UnaryOperator::UnaryNegation => {
            match u.argument.without_parentheses() {
                Expression::NumericLiteral(n) => Shape::Number(
                    Span {
                        start: u.span.start,
                        end: u.span.end,
                    },
                    -n.value,
                ),
                _ => other(expr),
            }
        }
        Expression::StringLiteral(s) => match string_of(s) {
            Some((value, quote)) => {
                Shape::String(span_of(s.span), value, LiteralForm::ContainerQuoted(quote))
            }
            None => other(expr),
        },
        Expression::TemplateLiteral(t) => match (t.expressions.is_empty(), t.quasis.first()) {
            (true, Some(quasi)) if !quasi.lone_surrogates => match &quasi.value.cooked {
                Some(cooked) => {
                    Shape::String(span_of(t.span), cooked.to_string(), LiteralForm::Template)
                }
                None => other(expr),
            },
            _ => other(expr),
        },
        Expression::BooleanLiteral(b) => Shape::Bool(span_of(b.span), b.value, LiteralForm::Bool),
        Expression::CallExpression(call) => {
            let callee = callee_name(&call.callee);
            if callee == "interpolate" {
                Shape::Interpolate(interpolate_of(call))
            } else {
                Shape::Call(callee)
            }
        }
        Expression::Identifier(id) => Shape::Ident(id.name.to_string()),
        _ => other(expr),
    }
}

fn interpolate_of(call: &CallExpression<'_>) -> Interpolate {
    let arg = |i: usize| call.arguments.get(i).and_then(|a| a.as_expression());
    let input = match arg(0).map(Expression::without_parentheses) {
        Some(Expression::Identifier(id)) => Input::Frame {
            name: id.name.to_string(),
            offset: 0.0,
        },
        Some(Expression::BinaryExpression(b)) if b.operator == BinaryOperator::Subtraction => {
            match (b.left.without_parentheses(), b.right.without_parentheses()) {
                (Expression::Identifier(id), Expression::NumericLiteral(n)) => Input::Frame {
                    name: id.name.to_string(),
                    offset: n.value,
                },
                _ => Input::Other,
            }
        }
        _ => Input::Other,
    };
    let numbers = |i: usize| -> Option<Vec<(Span, f64)>> {
        let Some(Expression::ArrayExpression(array)) = arg(i).map(Expression::without_parentheses)
        else {
            return None;
        };
        array
            .elements
            .iter()
            .map(|e| match shape_of(e.as_expression()?) {
                Shape::Number(span, value) => Some((span, value)),
                _ => None,
            })
            .collect()
    };
    Interpolate {
        call: Span {
            start: call.span.start,
            end: call.span.end,
        },
        input,
        input_range: numbers(1).map(|v| v.into_iter().map(|(_, n)| n).collect()),
        output_range: numbers(2),
        has_options: call.arguments.len() > 3,
        keyframes_exact: arg(3).is_none_or(known_easing),
    }
}

/// Whether `options` is an object literal whose `easing`, if written, is a
/// plain `Easings.<name>`.
fn known_easing(options: &Expression<'_>) -> bool {
    let Expression::ObjectExpression(object) = options.without_parentheses() else {
        return false;
    };
    object.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if property.computed {
            return false;
        }
        if property
            .key
            .static_name()
            .is_none_or(|name| name != "easing")
        {
            return true;
        }
        !property.shorthand
            && matches!(
                property.value.without_parentheses(),
                Expression::StaticMemberExpression(m)
                    if matches!(&m.object, Expression::Identifier(id) if id.name == "Easings")
            )
    })
}

/// A string literal's value and opening quote, or `None` when the value is
/// not exactly the written text (lone surrogates).
pub(crate) fn string_of(s: &StringLiteral<'_>) -> Option<(String, char)> {
    if s.lone_surrogates {
        return None;
    }
    let quote = s.raw.as_ref()?.chars().next()?;
    Some((s.value.to_string(), quote))
}

pub(crate) fn span_of(span: oxc_span::Span) -> Span {
    Span {
        start: span.start,
        end: span.end,
    }
}

fn other(expr: &Expression<'_>) -> Shape {
    Shape::Other(span_of(expr.span()))
}

fn callee_name(callee: &Expression<'_>) -> String {
    match callee.without_parentheses() {
        Expression::Identifier(id) => id.name.to_string(),
        // `Foo.bar(...)`: report the dotted path where it is a plain chain.
        Expression::StaticMemberExpression(m) => {
            format!("{}.{}", callee_name(&m.object), m.property.name)
        }
        _ => "<expression>".to_string(),
    }
}
