use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, BindingIdentifier, Function, FunctionBody,
    IdentifierReference, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXOpeningElement,
    Statement, VariableDeclarationKind,
};
use oxc_ast_visit::Visit;
use oxc_syntax::scope::ScopeFlags;

use crate::apply::Edit;
use crate::locate::ElementRef;
use crate::parse_checked;
use crate::shape::{Input, Interpolate, Shape, shape_of, span_of, string_of};

/// A byte range of the source text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

/// A prop value read from or written to the source.
#[derive(Debug, Clone, PartialEq)]
pub enum EditValue {
    Number(f64),
    String(String),
    Bool(bool),
}

impl EditValue {
    pub fn as_number(&self) -> Option<f64> {
        match self {
            Self::Number(value) => Some(*value),
            _ => None,
        }
    }
}

/// How a literal is written, so a write keeps its style.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LiteralForm {
    /// `12`, `-12`.
    Number,
    /// `name="…"` / `name='…'`: an attribute string, no container.
    Quoted(char),
    /// `name={'…'}` / `name={"…"}`, or a `const` initializer.
    ContainerQuoted(char),
    /// `` name={`…`} `` without `${}`.
    Template,
    /// `name` alone, which is `true`.
    BareTrue,
    /// `name={true}` / `name={false}`.
    Bool,
}

/// Where a prop's value lives in the source, or why it cannot be edited.
#[derive(Debug, Clone, PartialEq)]
pub enum EditTarget {
    /// A literal written as `form`; replace `span`. For `Quoted` the span
    /// covers the quotes; for `BareTrue` it is the empty point right after
    /// the attribute name.
    Literal {
        span: Span,
        value: EditValue,
        form: LiteralForm,
    },
    /// An `interpolate()` output entry at the current frame; replace `span`.
    Keyframe {
        span: Span,
        value: f64,
        frame: f64,
    },
    /// The prop is absent; insert it at `insert_at`. `default` is the value
    /// it takes meanwhile, when known.
    Missing {
        insert_at: u32,
        default: Option<EditValue>,
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
    pub received: Option<EditValue>,
    /// How many times the element rendered in the frame.
    pub render_count: u32,
}

/// Value of a prop that is absent from the source, when known.
pub fn default_for(prop: &str) -> Option<EditValue> {
    match prop {
        "scale" | "scaleX" | "scaleY" => Some(EditValue::Number(1.0)),
        "x" | "y" | "rotation" => Some(EditValue::Number(0.0)),
        _ => None,
    }
}

impl EditTarget {
    /// The edit that writes `value`, or `None` when the target is locked,
    /// `value` is a number that is not finite, or a keyframe is given
    /// anything but a number.
    pub fn to_edit(&self, prop: &str, value: &EditValue) -> Option<Edit> {
        if value.as_number().is_some_and(|n| !n.is_finite()) {
            return None;
        }
        match self {
            Self::Literal { span, form, .. } => Some(Edit::Replace {
                start: span.start,
                end: span.end,
                value: value.clone(),
                form: *form,
            }),
            Self::Keyframe { span, .. } => Some(Edit::Replace {
                start: span.start,
                end: span.end,
                value: EditValue::Number(value.as_number()?),
                form: LiteralForm::Number,
            }),
            Self::Missing { insert_at, .. } => Some(Edit::Insert {
                at: *insert_at,
                name: prop.to_string(),
                value: value.clone(),
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
    check_received(target, ctx.received.as_ref(), text, prop)
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
            value: EditValue::Number(*value),
            form: LiteralForm::Number,
        },
        Shape::String(span, value, form) => EditTarget::Literal {
            span: *span,
            value: EditValue::String(value.clone()),
            form: *form,
        },
        Shape::Bool(span, value, form) => EditTarget::Literal {
            span: *span,
            value: EditValue::Bool(*value),
            form: *form,
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
        Shape::Number(..) | Shape::String(..) | Shape::Bool(..) | Shape::Interpolate(_) => {
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
    let Some(received) = ctx.received.as_ref().and_then(EditValue::as_number) else {
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
/// Numbers match within the tolerance, strings and booleans exactly. A
/// literal of another kind than the received value (`x="12"` for a number)
/// is not written as the prop's value, so it locks as an expression.
fn check_received(
    target: EditTarget,
    received: Option<&EditValue>,
    text: &str,
    prop: &str,
) -> EditTarget {
    let same = match (&target, received) {
        (
            EditTarget::Literal {
                value: EditValue::Number(a),
                ..
            }
            | EditTarget::Keyframe { value: a, .. },
            Some(EditValue::Number(b)),
        ) => (a - b).abs() <= TOLERANCE,
        (EditTarget::Literal { span, value, form }, Some(received)) => {
            if std::mem::discriminant(value) != std::mem::discriminant(received) {
                return match form {
                    // The attribute alone: its source is its name.
                    LiteralForm::BareTrue => EditTarget::Locked(LockReason::Expression {
                        source: prop.to_string(),
                    }),
                    _ => expression(text, *span),
                };
            }
            value == received
        }
        (EditTarget::Literal { .. } | EditTarget::Keyframe { .. }, _) => false,
        _ => return target,
    };
    if same {
        target
    } else {
        EditTarget::Locked(LockReason::OverriddenByParent)
    }
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
                        let whole = Shape::Other(span_of(attr.span));
                        let shape = match &attr.value {
                            Some(JSXAttributeValue::ExpressionContainer(c)) => {
                                c.expression.as_expression().map_or(whole, shape_of)
                            }
                            Some(JSXAttributeValue::StringLiteral(s)) => match string_of(s) {
                                // oxc keeps entities (`&amp;`) undecoded, so
                                // a value with `&` may not be what the
                                // runtime receives.
                                Some((value, _)) if value.contains('&') => {
                                    Shape::Other(span_of(s.span))
                                }
                                Some((value, quote)) => Shape::String(
                                    span_of(s.span),
                                    value,
                                    LiteralForm::Quoted(quote),
                                ),
                                None => whole,
                            },
                            // `name` alone: the empty point after the name,
                            // where `={false}` would go.
                            None => {
                                let end = name.span.end;
                                Shape::Bool(Span { start: end, end }, true, LiteralForm::BareTrue)
                            }
                            Some(
                                JSXAttributeValue::Element(_) | JSXAttributeValue::Fragment(_),
                            ) => whole,
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
