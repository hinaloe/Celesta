use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, BinaryOperator, CallExpression, Expression,
    Function, FunctionBody, IdentifierReference, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXOpeningElement, Statement, UnaryOperator, VariableDeclarationKind,
};
use oxc_ast_visit::Visit;
use oxc_span::GetSpan;
use oxc_syntax::scope::ScopeFlags;

use crate::apply::Edit;
use crate::locate::ElementRef;
use crate::parse_checked;

/// A byte range of the source text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

/// Where a prop's value lives in the source, or why it cannot be edited.
#[derive(Debug, Clone, PartialEq)]
pub enum EditTarget {
    /// A numeric literal; replace `span`.
    Literal {
        span: Span,
        value: f64,
    },
    /// An `interpolate()` output entry at the current frame; replace `span`.
    Keyframe {
        span: Span,
        value: f64,
        frame: f64,
    },
    /// The prop is absent; insert it at `insert_at`.
    Missing {
        insert_at: u32,
        default: f64,
    },
    Locked(LockReason),
}

#[derive(Debug, Clone, PartialEq)]
pub enum LockReason {
    /// The parser reported an error; the file is never edited.
    SyntaxError,
    /// No JSX element starts at the given `ElementRef`.
    ElementNotFound,
    NotPrimitive,
    Expression {
        source: String,
    },
    UnresolvedIdentifier {
        name: String,
    },
    SharedBinding {
        name: String,
        uses: usize,
    },
    BetweenKeyframes {
        previous: f64,
        next: f64,
    },
    OutsideKeyframes,
    UnsupportedCall {
        callee: String,
    },
    OverriddenByParent,
    Spread,
    Repeated {
        count: u32,
    },
}

/// What the runtime reported about the element in the current frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ResolveContext {
    /// The element is a primitive (not a user component).
    pub primitive: bool,
    pub local_frame: f64,
    /// The prop value the runtime saw, if any.
    pub received: Option<f64>,
    /// How many times the element rendered in the frame.
    pub render_count: u32,
}

/// Value of a prop that is absent from the source.
pub fn default_for(prop: &str) -> f64 {
    match prop {
        "scale" | "scaleX" | "scaleY" => 1.0,
        _ => 0.0,
    }
}

impl EditTarget {
    /// The edit that writes `value`, or `None` when the target is locked or
    /// `value` is not finite.
    pub fn to_edit(&self, prop: &str, value: f64) -> Option<Edit> {
        if !value.is_finite() {
            return None;
        }
        match self {
            Self::Literal { span, .. } | Self::Keyframe { span, .. } => Some(Edit::Replace {
                start: span.start,
                end: span.end,
                value,
            }),
            Self::Missing { insert_at, .. } => Some(Edit::Insert {
                at: *insert_at,
                name: prop.to_string(),
                value,
            }),
            Self::Locked(_) => None,
        }
    }
}

const TOLERANCE: f64 = 1e-6;

/// Finds the source location of `prop` on `element`. Rules run in the order
/// the spec lists them; the first that applies decides.
pub fn resolve(text: &str, element: &ElementRef, prop: &str, ctx: &ResolveContext) -> EditTarget {
    let alloc = Allocator::default();
    let (program, failed) = parse_checked(text, &alloc);
    if failed {
        return EditTarget::Locked(LockReason::SyntaxError);
    }
    if !ctx.primitive {
        return EditTarget::Locked(LockReason::NotPrimitive);
    }
    if ctx.render_count > 1 {
        return EditTarget::Locked(LockReason::Repeated {
            count: ctx.render_count,
        });
    }

    let mut gather = Gather {
        element_start: element.start,
        prop,
        found: false,
        has_spread: false,
        attr: None,
        scopes: Vec::new(),
        refs: HashMap::new(),
    };
    gather.visit_program(&program);
    if !gather.found {
        return EditTarget::Locked(LockReason::ElementNotFound);
    }

    let Some(shape) = &gather.attr else {
        if gather.has_spread {
            return EditTarget::Locked(LockReason::Spread);
        }
        if ctx.received.is_some() {
            return EditTarget::Locked(LockReason::OverriddenByParent);
        }
        return EditTarget::Missing {
            insert_at: element.end_of_attributes,
            default: default_for(prop),
        };
    };

    let target = resolve_shape(shape, &gather, text, ctx);
    check_received(target, ctx.received)
}

fn resolve_shape(shape: &Shape, gather: &Gather, text: &str, ctx: &ResolveContext) -> EditTarget {
    match shape {
        Shape::Number(span, value) => EditTarget::Literal {
            span: *span,
            value: *value,
        },
        Shape::Interpolate(call) => resolve_keyframe(call, gather, text, ctx.local_frame),
        Shape::Call(callee) => EditTarget::Locked(LockReason::UnsupportedCall {
            callee: callee.clone(),
        }),
        Shape::Ident(name) => resolve_identifier(name, gather, text, ctx),
        Shape::Other(span) => expression(text, *span),
    }
}

fn expression(text: &str, span: Span) -> EditTarget {
    EditTarget::Locked(LockReason::Expression {
        source: text[span.start as usize..span.end as usize].to_string(),
    })
}

fn resolve_identifier(name: &str, gather: &Gather, text: &str, ctx: &ResolveContext) -> EditTarget {
    let unresolved = || {
        EditTarget::Locked(LockReason::UnresolvedIdentifier {
            name: name.to_string(),
        })
    };
    let Some(Binding::Const(shape)) = gather.lookup(name) else {
        return unresolved();
    };
    match shape {
        Shape::Number(..) | Shape::Interpolate(_) => {
            let uses = gather.refs.get(name).copied().unwrap_or(0);
            if uses > 1 {
                return EditTarget::Locked(LockReason::SharedBinding {
                    name: name.to_string(),
                    uses,
                });
            }
            resolve_shape(shape, gather, text, ctx)
        }
        Shape::Call(callee) => EditTarget::Locked(LockReason::UnsupportedCall {
            callee: callee.clone(),
        }),
        Shape::Ident(_) | Shape::Other(_) => unresolved(),
    }
}

/// The keyframe rule: editable only at a frame that is an `inputRange` entry.
/// `options` is ignored, since easing does not change the value at a keyframe.
fn resolve_keyframe(
    call: &Interpolate,
    gather: &Gather,
    text: &str,
    local_frame: f64,
) -> EditTarget {
    let not_literal = || expression(text, call.call);
    let Input::Frame { name, offset } = &call.input else {
        return not_literal();
    };
    let frame_bound = matches!(
        gather.lookup(name),
        Some(Binding::Const(Shape::Call(callee))) if callee == "useCurrentFrame"
    );
    let (Some(inputs), Some(outputs)) = (&call.input_range, &call.output_range) else {
        return not_literal();
    };
    if !frame_bound || inputs.is_empty() || inputs.len() != outputs.len() {
        return not_literal();
    }

    let frame = local_frame - offset;
    if let Some(k) = inputs.iter().position(|i| (i - frame).abs() <= TOLERANCE) {
        let (span, value) = outputs[k];
        return EditTarget::Keyframe {
            span,
            value,
            frame: inputs[k] + offset,
        };
    }
    let previous = inputs
        .iter()
        .copied()
        .filter(|i| *i < frame)
        .reduce(f64::max);
    let next = inputs
        .iter()
        .copied()
        .filter(|i| *i > frame)
        .reduce(f64::min);
    match (previous, next) {
        (Some(previous), Some(next)) => EditTarget::Locked(LockReason::BetweenKeyframes {
            previous: previous + offset,
            next: next + offset,
        }),
        _ => EditTarget::Locked(LockReason::OutsideKeyframes),
    }
}

/// The resolved value must equal what the runtime saw; otherwise a parent or
/// another binding decided the prop.
fn check_received(target: EditTarget, received: Option<f64>) -> EditTarget {
    let value = match &target {
        EditTarget::Literal { value, .. } | EditTarget::Keyframe { value, .. } => *value,
        _ => return target,
    };
    match received {
        Some(r) if (r - value).abs() <= TOLERANCE => target,
        _ => EditTarget::Locked(LockReason::OverriddenByParent),
    }
}

/// An attribute value or initializer, reduced to what the rules need.
#[derive(Debug)]
enum Shape {
    Number(Span, f64),
    Interpolate(Interpolate),
    Call(String),
    Ident(String),
    Other(Span),
}

/// An `interpolate(input, inputRange, outputRange, ...)` call whose ranges
/// are kept only when they are arrays of numeric literals.
#[derive(Debug)]
struct Interpolate {
    /// The whole call, reported when it is not editable.
    call: Span,
    input: Input,
    input_range: Option<Vec<f64>>,
    output_range: Option<Vec<(Span, f64)>>,
}

#[derive(Debug)]
enum Input {
    /// `name`, or `name - offset`.
    Frame {
        name: String,
        offset: f64,
    },
    Other,
}

#[derive(Debug)]
enum Binding {
    Const(Shape),
    /// `let`, `var`, parameters, destructuring: never editable.
    Other,
}

struct Scope {
    bindings: Vec<(String, Binding)>,
}

struct Gather<'t> {
    element_start: u32,
    prop: &'t str,
    found: bool,
    has_spread: bool,
    attr: Option<Shape>,
    /// Functions enclosing the element, outermost first.
    scopes: Vec<Scope>,
    refs: HashMap<String, usize>,
}

impl Gather<'_> {
    /// Innermost binding of `name` among the enclosing functions.
    fn lookup(&self, name: &str) -> Option<&Binding> {
        self.scopes
            .iter()
            .rev()
            .find_map(|s| s.bindings.iter().find(|(n, _)| n == name).map(|(_, b)| b))
    }

    fn encloses_element(&self, span: oxc_span::Span) -> bool {
        span.start <= self.element_start && self.element_start < span.end
    }

    fn push_scope(
        &mut self,
        params: &oxc_ast::ast::FormalParameters<'_>,
        body: Option<&FunctionBody<'_>>,
    ) {
        let mut bindings = Vec::new();
        for param in &params.items {
            for id in param.pattern.get_binding_identifiers() {
                bindings.push((id.name.to_string(), Binding::Other));
            }
        }
        if let Some(rest) = &params.rest {
            for id in rest.rest.argument.get_binding_identifiers() {
                bindings.push((id.name.to_string(), Binding::Other));
            }
        }
        for stmt in body.iter().flat_map(|b| &b.statements) {
            let Statement::VariableDeclaration(decl) = stmt else {
                continue;
            };
            for d in &decl.declarations {
                let simple = d.id.get_binding_identifier();
                match (decl.kind, simple, &d.init) {
                    (VariableDeclarationKind::Const, Some(id), Some(init)) => {
                        bindings.push((id.name.to_string(), Binding::Const(shape_of(init))));
                    }
                    _ => {
                        for id in d.id.get_binding_identifiers() {
                            bindings.push((id.name.to_string(), Binding::Other));
                        }
                    }
                }
            }
        }
        self.scopes.push(Scope { bindings });
    }
}

fn shape_of(expr: &Expression<'_>) -> Shape {
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
    }
}

fn other(expr: &Expression<'_>) -> Shape {
    let span = expr.span();
    Shape::Other(Span {
        start: span.start,
        end: span.end,
    })
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

impl<'a> Visit<'a> for Gather<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        let pushed = self.encloses_element(it.span);
        if pushed {
            self.push_scope(&it.params, it.body.as_deref());
        }
        oxc_ast_visit::walk::walk_function(self, it, flags);
        // Scopes stay pushed: only functions enclosing the element get one,
        // and those are visited outermost first.
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if self.encloses_element(it.span) {
            let body = match &it.body {
                ArrowFunctionBody::FunctionBody(b) => Some(&**b),
                _ => None,
            };
            self.push_scope(&it.params, body);
        }
        oxc_ast_visit::walk::walk_arrow_function_expression(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        *self.refs.entry(it.name.to_string()).or_insert(0) += 1;
    }

    fn visit_jsx_opening_element(&mut self, it: &JSXOpeningElement<'a>) {
        if it.span.start == self.element_start && !self.found {
            self.found = true;
            for item in &it.attributes {
                match item {
                    JSXAttributeItem::SpreadAttribute(_) => self.has_spread = true,
                    JSXAttributeItem::Attribute(attr) => {
                        let JSXAttributeName::Identifier(name) = &attr.name else {
                            continue;
                        };
                        if name.name != self.prop {
                            continue;
                        }
                        // A later duplicate wins, as at runtime.
                        let shape = match &attr.value {
                            Some(JSXAttributeValue::ExpressionContainer(c)) => {
                                match c.expression.as_expression() {
                                    Some(e) => shape_of(e),
                                    None => Shape::Other(Span {
                                        start: attr.span.start,
                                        end: attr.span.end,
                                    }),
                                }
                            }
                            _ => Shape::Other(Span {
                                start: attr.span.start,
                                end: attr.span.end,
                            }),
                        };
                        self.attr = Some(shape);
                    }
                }
            }
        }
        oxc_ast_visit::walk::walk_jsx_opening_element(self, it);
    }
}
