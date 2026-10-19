use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, BinaryOperator, BindingIdentifier, CallExpression,
    Expression, Function, FunctionBody, IdentifierReference, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXOpeningElement, ObjectPropertyKind, Statement, UnaryOperator,
    VariableDeclarationKind,
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
    /// The frame `frame` reads lies between two `inputRange` entries.
    /// `previous` and `next` are in the same frames as `frame`, the candidate
    /// frame they were found from, so a timeline frame converts to them by
    /// the difference between the lookup's timeline frame and `frame`.
    BetweenKeyframes {
        previous: f64,
        next: f64,
        frame: f64,
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
    /// The animation could read more than one of the element's candidate
    /// frames, and they give different keyframes (or none can be told apart
    /// from the received value), so no keyframe can be picked.
    FrameUncertain,
    /// The element's file is outside the project (or in `node_modules`).
    OutsideProject,
}

/// What the runtime reported about the element in the current frame.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolveContext {
    /// The element is a primitive (not a user component).
    pub primitive: bool,
    /// The frames an `interpolate(frame, …)` written for the element could
    /// read: what `useCurrentFrame()` returns under each frame provider
    /// above the element. Whichever component read `frame` sits above the
    /// element (or wrote it), so the frame it read is one of these. Empty
    /// locks keyframe targets as `FrameUncertain`.
    pub candidate_frames: Vec<f64>,
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
        spread_after: false,
        attr: None,
        scopes: Vec::new(),
        outer: None,
        declarations: Vec::new(),
        refs: HashMap::new(),
    };
    gather.visit_program(&program);
    if !gather.found {
        return EditTarget::Locked(LockReason::ElementNotFound);
    }

    if gather.attr.is_some() && gather.spread_after {
        // `<Rect x={5} {...p} />`: the spread may set `x` after the attribute.
        return EditTarget::Locked(LockReason::Spread);
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

/// Whether `prop` is written as an attribute on `element` (a spread does not
/// count). False when the text does not parse or the element is not found.
pub fn has_attribute(text: &str, element: &ElementRef, prop: &str) -> bool {
    let alloc = Allocator::default();
    let (program, failed) = parse_checked(text, &alloc);
    if failed {
        return false;
    }
    let mut gather = Gather {
        element_start: element.start,
        prop,
        found: false,
        has_spread: false,
        spread_after: false,
        attr: None,
        scopes: Vec::new(),
        outer: None,
        declarations: Vec::new(),
        refs: HashMap::new(),
    };
    gather.visit_program(&program);
    gather.attr.is_some()
}

fn resolve_shape(shape: &Shape, gather: &Gather, text: &str, ctx: &ResolveContext) -> EditTarget {
    match shape {
        Shape::Number(span, value) => EditTarget::Literal {
            span: *span,
            value: *value,
        },
        Shape::Interpolate(call) => resolve_keyframe(call, gather, text, ctx),
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
    if gather.declared_more_than_once(name) {
        return unresolved();
    }
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
///
/// `frame` is one of `ctx.candidate_frames`, and the received value tells
/// them apart: a candidate whose value differs is ruled out. A keyframe's
/// value is its `outputRange` entry when the easing gives 0 and 1 at the ends
/// of each segment (none, or a named `Easings` one), and a keyframe candidate
/// is kept otherwise; between or outside the keyframes the value is known only
/// without an `options` argument (linear, `extend` extrapolation), and a
/// candidate there is kept otherwise.
/// The survivors must all point at the same target, or the frame is
/// uncertain.
fn resolve_keyframe(
    call: &Interpolate,
    gather: &Gather,
    text: &str,
    ctx: &ResolveContext,
) -> EditTarget {
    let not_literal = || expression(text, call.call);
    let Input::Frame { name, offset } = &call.input else {
        return not_literal();
    };
    if gather.declared_more_than_once(name) {
        return EditTarget::Locked(LockReason::UnresolvedIdentifier { name: name.clone() });
    }
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
    // `interpolate()` always returns a number, so an element that received
    // none had the prop set by something else.
    let Some(received) = ctx.received else {
        return EditTarget::Locked(LockReason::OverriddenByParent);
    };
    if ctx.candidate_frames.is_empty() {
        return EditTarget::Locked(LockReason::FrameUncertain);
    }

    let values: Vec<f64> = outputs.iter().map(|(_, value)| *value).collect();
    let mut survivors: Vec<Place> = Vec::new();
    for &candidate in &ctx.candidate_frames {
        let place = place_of(inputs, candidate - offset);
        let value = match place {
            Place::Keyframe(k) if call.keyframes_exact => Some(values[k]),
            Place::Keyframe(_) => None,
            Place::Between { .. } | Place::Outside if !call.has_options => {
                linear(inputs, &values, candidate - offset)
            }
            Place::Between { .. } | Place::Outside => None,
        };
        if value.is_some_and(|value| !same_value(value, received)) {
            continue;
        }
        let place = match place {
            Place::Between { previous, next, .. } => Place::Between {
                previous,
                next,
                frame: candidate,
            },
            other => other,
        };
        if !survivors.contains(&place) {
            survivors.push(place);
        }
    }

    match survivors.as_slice() {
        [] => EditTarget::Locked(LockReason::OverriddenByParent),
        [Place::Keyframe(k)] => {
            let (span, value) = outputs[*k];
            EditTarget::Keyframe {
                span,
                value,
                frame: inputs[*k] + offset,
            }
        }
        [
            Place::Between {
                previous,
                next,
                frame,
            },
        ] => EditTarget::Locked(LockReason::BetweenKeyframes {
            previous: previous + offset,
            next: next + offset,
            frame: *frame,
        }),
        [Place::Outside] => EditTarget::Locked(LockReason::OutsideKeyframes),
        // Different keyframes, or the same keyframes at different frames
        // (whose jumps would differ).
        _ => EditTarget::Locked(LockReason::FrameUncertain),
    }
}

/// Where a frame (already minus the literal offset) falls in `inputRange`.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Place {
    /// At `inputRange[k]`.
    Keyframe(usize),
    /// Strictly between two entries; `frame` is the candidate frame,
    /// filled in once the place is kept.
    Between {
        previous: f64,
        next: f64,
        frame: f64,
    },
    Outside,
}

fn place_of(inputs: &[f64], frame: f64) -> Place {
    if let Some(k) = inputs.iter().position(|i| (i - frame).abs() <= TOLERANCE) {
        return Place::Keyframe(k);
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
        (Some(previous), Some(next)) => Place::Between {
            previous,
            next,
            frame: 0.0,
        },
        _ => Place::Outside,
    }
}

/// `interpolate(frame, inputs, outputs)` without options, as the runtime
/// computes it (linear, extending the end segments outside), or `None` when
/// the ranges would make it throw.
fn linear(inputs: &[f64], outputs: &[f64], frame: f64) -> Option<f64> {
    if inputs.len() < 2 || inputs.windows(2).any(|w| w[1] <= w[0]) {
        return None;
    }
    let mut segment = 0;
    while segment < inputs.len() - 2 && frame >= inputs[segment + 1] {
        segment += 1;
    }
    let progress = (frame - inputs[segment]) / (inputs[segment + 1] - inputs[segment]);
    Some(outputs[segment] + progress * (outputs[segment + 1] - outputs[segment]))
}

/// Equal up to rounding, relative to the values' size.
fn same_value(a: f64, b: f64) -> bool {
    (a - b).abs() <= TOLERANCE * a.abs().max(b.abs()).max(1.0)
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
    /// A fourth (`options`) argument is written: easing or extrapolation
    /// may change the value between and outside the keyframes.
    has_options: bool,
    /// The value at each `inputRange` entry is its `outputRange` entry: the
    /// easing is absent or a named `Easings` member, so it gives 0 and 1 at
    /// the ends of a segment. A hand-written one may not
    /// (`t => t === 0 ? 0.5 : t`).
    keyframes_exact: bool,
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
    /// A spread follows the last `prop` attribute.
    spread_after: bool,
    attr: Option<Shape>,
    /// Functions enclosing the element, outermost first.
    scopes: Vec<Scope>,
    /// The outermost function enclosing the element.
    outer: Option<oxc_span::Span>,
    /// Every binding the file declares (variables, parameters, catch
    /// parameters, destructured names, functions, imports), with its offset.
    declarations: Vec<(String, u32)>,
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

    /// Whether `name` is declared more than once in the outermost function
    /// enclosing the element (anywhere in the file when there is none). Only
    /// function-level `const`s are modelled, so a second declaration in a
    /// block, loop, `catch` or nested function could be the one in effect.
    /// A module-level declaration is never resolved, and one inside the
    /// function shadows it, so those are not counted.
    fn declared_more_than_once(&self, name: &str) -> bool {
        self.declarations
            .iter()
            .filter(|(declared, at)| {
                declared == name
                    && self
                        .outer
                        .is_none_or(|outer| outer.start <= *at && *at < outer.end)
            })
            .count()
            > 1
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
        if pushed && self.outer.is_none() {
            self.outer = Some(it.span);
        }
        if pushed {
            self.push_scope(&it.params, it.body.as_deref());
        }
        oxc_ast_visit::walk::walk_function(self, it, flags);
        // Scopes stay pushed: only functions enclosing the element get one,
        // and those are visited outermost first.
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        if self.encloses_element(it.span) {
            if self.outer.is_none() {
                self.outer = Some(it.span);
            }
            let body = match &it.body {
                ArrowFunctionBody::FunctionBody(b) => Some(&**b),
                _ => None,
            };
            self.push_scope(&it.params, body);
        }
        oxc_ast_visit::walk::walk_arrow_function_expression(self, it);
    }

    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        self.declarations.push((it.name.to_string(), it.span.start));
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        *self.refs.entry(it.name.to_string()).or_insert(0) += 1;
    }

    fn visit_jsx_opening_element(&mut self, it: &JSXOpeningElement<'a>) {
        if it.span.start == self.element_start && !self.found {
            self.found = true;
            for item in &it.attributes {
                match item {
                    JSXAttributeItem::SpreadAttribute(_) => {
                        self.has_spread = true;
                        self.spread_after = self.attr.is_some();
                    }
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
                        self.spread_after = false;
                    }
                }
            }
        }
        oxc_ast_visit::walk::walk_jsx_opening_element(self, it);
    }
}
