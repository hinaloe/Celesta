use std::collections::HashMap;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    ArrowFunctionBody, ArrowFunctionExpression, BindingIdentifier, BindingPattern, Expression,
    Function, FunctionBody, IdentifierReference, JSXAttributeItem, JSXAttributeName,
    JSXAttributeValue, JSXElement, JSXOpeningElement, Statement, VariableDeclarationKind,
    VariableDeclarator,
};
use oxc_ast_visit::Visit;
use oxc_syntax::scope::ScopeFlags;

use crate::apply::Edit;
use crate::locate::ElementRef;
use crate::parse_checked;
use crate::pass_through::{component_function, is_component_name};
use crate::shape::{
    Children, Input, Interpolate, Shape, StyleProperty, children_of, shape_of, span_of, string_of,
    style_property,
};

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
    /// The element's one child is JSXText: `<Text>Sale</Text>`.
    JsxText,
    /// The element's one child is `{'…'}` / `{"…"}`.
    ChildContainer(char),
}

/// Where a prop's value lives in the source, or why it cannot be edited.
#[derive(Debug, Clone, PartialEq)]
pub enum EditTarget {
    /// A literal written as `form`; replace `span`. For `Quoted` the span
    /// covers the quotes; for `BareTrue` it is the empty point right after
    /// the attribute name; for `JsxText` and `ChildContainer` it covers
    /// everything between the tags.
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
    /// The prop comes from parameter `param` of the enclosing component;
    /// `target` is the prop at the call site `call_site` (in another text).
    PassThrough {
        call_site: ElementRef,
        param: String,
        target: Box<EditTarget>,
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
    /// `style.<key>` on an element without a `style` attribute: there is no
    /// object to edit, and the shorthand prop is what sets the value.
    NoStyleObject,
    /// The value is a parameter of `component` that its caller passes on
    /// again (a second hop).
    ParameterOfCaller {
        component: String,
    },
    /// No chain entry calls the enclosing component.
    CallSiteNotFound {
        component: String,
    },
}

/// What the runtime reported about the element in the current frame.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolveContext {
    /// The element is a primitive (not a user component).
    pub primitive: bool,
    /// Read the props written on a component element too (a pass-through's
    /// call site); otherwise a non-primitive element is `NotPrimitive`.
    pub component_props: bool,
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
    /// anything but a number. A `PassThrough` writes its inner target at the
    /// call site as `param`, whatever `prop` the element reads it as; the
    /// edit applies to the call site's text.
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
            Self::Missing { insert_at, .. } => Some(match PropPath::parse(prop) {
                PropPath::Attribute(name) => Edit::Insert {
                    at: *insert_at,
                    name: name.to_string(),
                    value: value.clone(),
                },
                PropPath::Children => Edit::Replace {
                    start: *insert_at,
                    end: *insert_at,
                    value: value.clone(),
                    form: LiteralForm::JsxText,
                },
                PropPath::Style(key) => Edit::InsertProperty {
                    at: *insert_at,
                    key: key.to_string(),
                    value: value.clone(),
                },
            }),
            Self::PassThrough { param, target, .. } => target.to_edit(param, value),
            Self::Locked(_) => None,
        }
    }
}

/// What a prop path names on an element.
#[derive(Debug, Clone, Copy)]
pub(crate) enum PropPath<'p> {
    /// An attribute.
    Attribute(&'p str),
    /// `children`: the element's children, or its `children` attribute
    /// when it has none.
    Children,
    /// `style.<key>`: property `<key>` of a `style={{ … }}` object literal.
    Style(&'p str),
}

impl<'p> PropPath<'p> {
    pub(crate) fn parse(prop: &'p str) -> Self {
        if prop == "children" {
            Self::Children
        } else if let Some(key) = prop.strip_prefix("style.") {
            Self::Style(key)
        } else {
            Self::Attribute(prop)
        }
    }

    /// The attribute that holds the prop.
    fn attribute(self) -> &'p str {
        match self {
            Self::Attribute(name) => name,
            Self::Children => "children",
            Self::Style(_) => "style",
        }
    }
}

const TOLERANCE: f64 = 1e-6;

/// Finds the source location of `prop` on `element`. Rules run in the order
/// the spec lists them; the first that applies decides.
///
/// `prop` is an attribute name, `children` for the element's children, or
/// `style.<key>` for a property of a `style={{ … }}` object literal.
pub fn resolve(text: &str, element: &ElementRef, prop: &str, ctx: &ResolveContext) -> EditTarget {
    resolve_with(text, element, prop, ctx, None)
}

/// [`resolve`], at a call site when `parameter` is the default of the
/// parameter the prop is passed to: an absent prop then takes that default,
/// and the received value is checked against it.
pub(crate) fn resolve_with(
    text: &str,
    element: &ElementRef,
    prop: &str,
    ctx: &ResolveContext,
    parameter: Option<&ParamDefault>,
) -> EditTarget {
    let alloc = Allocator::default();
    let (program, failed) = parse_checked(text, &alloc);
    if failed {
        return EditTarget::Locked(LockReason::SyntaxError);
    }
    if !ctx.primitive && !ctx.component_props {
        return EditTarget::Locked(LockReason::NotPrimitive);
    }
    if ctx.render_count > 1 {
        return EditTarget::Locked(LockReason::Repeated {
            count: ctx.render_count,
        });
    }

    let path = PropPath::parse(prop);
    let mut gather = Gather::new(element.start, path);
    gather.visit_program(&program);
    if !gather.found {
        return EditTarget::Locked(LockReason::ElementNotFound);
    }

    // JSX children win over a `children` attribute and a spread. Without
    // any, a `children` attribute follows the attribute rules below.
    if let (PropPath::Children, Some(children)) = (path, &gather.children) {
        let child = |span: Span, value: &str, form| {
            let target = EditTarget::Literal {
                span,
                value: EditValue::String(value.to_string()),
                form,
            };
            check_received(target, ctx.received.as_ref(), text, prop)
        };
        match children {
            Children::Text { span, value } => return child(*span, value, LiteralForm::JsxText),
            Children::Container { span, value, quote } => {
                return child(*span, value, LiteralForm::ChildContainer(*quote));
            }
            Children::Reference { shape } => {
                let target = resolve_shape(shape, &gather, text, ctx);
                return check_received(target, ctx.received.as_ref(), text, prop);
            }
            Children::Other(span) => return expression(text, *span),
            // 2b opens the tag before writing children into it.
            Children::SelfClosing if gather.attr.is_none() => {
                return EditTarget::Locked(LockReason::Expression {
                    source: "/>".to_string(),
                });
            }
            Children::SelfClosing | Children::Empty { .. } => {}
        }
    }

    if gather.attr.is_some() && gather.spread_after {
        // `<Rect x={5} {...p} />`: the spread may set `x` after the attribute.
        return EditTarget::Locked(LockReason::Spread);
    }
    let Some(shape) = &gather.attr else {
        if gather.has_spread {
            return EditTarget::Locked(LockReason::Spread);
        }
        if let Some(default) = parameter {
            return missing_parameter(element, &gather, default, ctx.received.as_ref());
        }
        if ctx.received.is_some() {
            return EditTarget::Locked(LockReason::OverriddenByParent);
        }
        return match (path, &gather.children) {
            (PropPath::Children, Some(Children::Empty { insert_at })) => EditTarget::Missing {
                insert_at: *insert_at,
                default: Some(EditValue::String(String::new())),
            },
            (PropPath::Style(_), _) => EditTarget::Locked(LockReason::NoStyleObject),
            _ => EditTarget::Missing {
                insert_at: element.end_of_attributes,
                default: default_for(prop),
            },
        };
    };

    let target = match (path, &gather.property) {
        (PropPath::Style(_), Some(property)) => match property {
            StyleProperty::Value(shape) => resolve_shape(shape, &gather, text, ctx),
            StyleProperty::Absent { object, last } => {
                if ctx.received.is_some() {
                    return EditTarget::Locked(LockReason::OverriddenByParent);
                }
                return EditTarget::Missing {
                    insert_at: property_insert_at(text, *object, *last),
                    default: None,
                };
            }
            StyleProperty::Unknown => return EditTarget::Locked(LockReason::Spread),
            StyleProperty::NotObject(span) => return expression(text, *span),
        },
        _ => resolve_shape(shape, &gather, text, ctx),
    };
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
    let mut gather = Gather::new(element.start, PropPath::Attribute(prop));
    gather.visit_program(&program);
    gather.attr.is_some()
}

/// A parameter's default value.
#[derive(Debug, Clone)]
pub(crate) enum ParamDefault {
    /// None is written: an absent prop leaves the parameter `undefined`.
    None,
    Literal(EditValue),
    /// An expression, whose value is not known here.
    Other,
}

/// A prop value that is a parameter of a component enclosing the element.
#[derive(Debug)]
pub(crate) struct ParamInfo {
    /// The component, as a call site names it.
    pub(crate) component: String,
    /// The prop the call site passes.
    pub(crate) param: String,
    pub(crate) default: ParamDefault,
}

/// The parameter `prop` on `element` reads, when the value the rules would
/// read (the last attribute with no spread after it, the `style` property,
/// or a `{name}` child) is a parameter of an enclosing component. `None`
/// when the text does not parse.
pub(crate) fn parameter_in(text: &str, element: &ElementRef, prop: &str) -> Option<ParamInfo> {
    let alloc = Allocator::default();
    let (program, failed) = parse_checked(text, &alloc);
    if failed {
        return None;
    }
    let path = PropPath::parse(prop);
    let mut gather = Gather::new(element.start, path);
    gather.visit_program(&program);
    if !gather.found {
        return None;
    }
    let shape = match (path, &gather.children, &gather.property) {
        (PropPath::Children, Some(Children::Reference { shape }), _) => shape,
        (
            PropPath::Children,
            Some(Children::Text { .. } | Children::Container { .. } | Children::Other(_)),
            _,
        ) => return None,
        _ if gather.spread_after => return None,
        (PropPath::Style(_), _, Some(StyleProperty::Value(shape))) => shape,
        (PropPath::Style(_), ..) => return None,
        _ => gather.attr.as_ref()?,
    };
    gather.parameter(shape)
}

/// A prop absent at a call site takes the parameter's default. The
/// primitive must have received that default when it is a literal, and
/// nothing when there is none.
fn missing_parameter(
    element: &ElementRef,
    gather: &Gather,
    default: &ParamDefault,
    received: Option<&EditValue>,
) -> EditTarget {
    let same = match (default, received) {
        (ParamDefault::Other, _) | (ParamDefault::None, None) => true,
        (ParamDefault::Literal(EditValue::Number(a)), Some(EditValue::Number(b))) => {
            (a - b).abs() <= TOLERANCE
        }
        (ParamDefault::Literal(value), Some(received)) => value == received,
        _ => false,
    };
    if !same {
        return EditTarget::Locked(LockReason::OverriddenByParent);
    }
    let insert_at = match (gather.path, &gather.children) {
        (PropPath::Children, Some(Children::Empty { insert_at })) => *insert_at,
        _ => element.end_of_attributes,
    };
    EditTarget::Missing {
        insert_at,
        default: match default {
            ParamDefault::Literal(value) => Some(value.clone()),
            ParamDefault::None | ParamDefault::Other => None,
        },
    }
}

/// Where a property is added to an object literal: right after its `{`
/// when it is empty, otherwise after the last property, or after the
/// trailing comma that follows it.
fn property_insert_at(text: &str, object: Span, last: Option<u32>) -> u32 {
    let Some(last) = last else {
        return object.start + 1;
    };
    let next = skip_trivia(text, last as usize);
    if text[next..].starts_with(',') {
        next as u32 + 1
    } else {
        last
    }
}

/// The first offset at or after `at` that is neither whitespace nor inside
/// a comment.
fn skip_trivia(text: &str, mut at: usize) -> usize {
    loop {
        let rest = &text[at..];
        let trimmed = rest.trim_start();
        at += rest.len() - trimmed.len();
        let comment = if trimmed.starts_with("//") {
            trimmed.find('\n')
        } else if let Some(body) = trimmed.strip_prefix("/*") {
            body.find("*/").map(|end| end + 4)
        } else {
            None
        };
        match comment {
            Some(len) => at += len,
            None => return at,
        }
    }
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
        Shape::Member { span, .. } | Shape::Other(span) => expression(text, *span),
    }
}

/// Locks `span` as an expression. The source is trimmed: a children span
/// includes the whitespace between the tags.
fn expression(text: &str, span: Span) -> EditTarget {
    EditTarget::Locked(LockReason::Expression {
        source: text[span.start as usize..span.end as usize]
            .trim()
            .to_string(),
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
        Shape::Ident(_) | Shape::Member { .. } | Shape::Other(_) => unresolved(),
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
    /// A property of a component's first parameter (`{ label }`,
    /// `{ label = 'Sale' }`, `{ label: text }`): the call site's prop
    /// `param`.
    Parameter {
        component: String,
        param: String,
        default: ParamDefault,
    },
    /// A component's first parameter named `props`: `props.<key>` is the
    /// call site's prop `<key>`.
    Props {
        component: String,
    },
    /// `let`, `var`, other parameters, destructuring: never editable.
    Other,
}

struct Scope {
    /// The function's name when a call site can name it.
    component: Option<String>,
    bindings: Vec<(String, Binding)>,
}

pub(crate) struct Gather<'t> {
    element_start: u32,
    path: PropPath<'t>,
    pub(crate) found: bool,
    has_spread: bool,
    /// A spread follows the last attribute that holds the prop.
    spread_after: bool,
    /// The last attribute that holds the prop.
    attr: Option<Shape>,
    /// For `style.<key>`: the key in the last `style` attribute.
    property: Option<StyleProperty>,
    children: Option<Children>,
    /// Functions enclosing the element, outermost first.
    scopes: Vec<Scope>,
    /// The outermost function enclosing the element.
    outer: Option<oxc_span::Span>,
    /// Every binding the file declares (variables, parameters, catch
    /// parameters, destructured names, functions, imports), with its offset.
    declarations: Vec<(String, u32)>,
    refs: HashMap<String, usize>,
    /// Functions a `const` names (`const PriceTag = …`), by their offset.
    names: Vec<(u32, String)>,
}

impl<'t> Gather<'t> {
    pub(crate) fn new(element_start: u32, path: PropPath<'t>) -> Self {
        Self {
            element_start,
            path,
            found: false,
            has_spread: false,
            spread_after: false,
            attr: None,
            property: None,
            children: None,
            scopes: Vec::new(),
            outer: None,
            declarations: Vec::new(),
            refs: HashMap::new(),
            names: Vec::new(),
        }
    }

    /// The innermost function enclosing the element that a call site can
    /// name.
    pub(crate) fn component(&self) -> Option<&str> {
        self.scopes
            .iter()
            .rev()
            .find_map(|s| s.component.as_deref())
    }

    /// The parameter `shape` reads: an identifier bound by the first
    /// parameter of [`Self::component`], or `props.<key>`. A parameter of an
    /// outer component is not followed: the call site found is the inner
    /// component's, which never passes it.
    fn parameter(&self, shape: &Shape) -> Option<ParamInfo> {
        let (name, member) = match shape {
            Shape::Ident(name) => (name, None),
            Shape::Member {
                object, property, ..
            } => (object, Some(property)),
            _ => return None,
        };
        if self.declared_more_than_once(name) {
            return None;
        }
        let found = match (self.lookup(name)?, member) {
            (
                Binding::Parameter {
                    component,
                    param,
                    default,
                },
                None,
            ) => Some(ParamInfo {
                component: component.clone(),
                param: param.clone(),
                default: default.clone(),
            }),
            (Binding::Props { component }, Some(property)) => Some(ParamInfo {
                component: component.clone(),
                param: property.clone(),
                default: ParamDefault::None,
            }),
            _ => None,
        }?;
        (Some(found.component.as_str()) == self.component()).then_some(found)
    }

    /// The name a `const` gives the function starting at `start`.
    fn named(&self, start: u32) -> Option<&str> {
        self.names
            .iter()
            .find(|(at, _)| *at == start)
            .map(|(_, name)| name.as_str())
    }

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

    /// Pushes the scope of a function enclosing the element, named
    /// `name` (by its declaration or the `const` that holds it).
    fn push_scope(
        &mut self,
        name: Option<String>,
        params: &oxc_ast::ast::FormalParameters<'_>,
        body: Option<&FunctionBody<'_>>,
    ) {
        let component = name.filter(|name| is_component_name(name));
        let mut bindings = Vec::new();
        for (index, param) in params.items.iter().enumerate() {
            match &component {
                Some(component) if index == 0 => {
                    parameter_bindings(&param.pattern, component, &mut bindings);
                }
                _ => other_bindings(&param.pattern, &mut bindings),
            }
        }
        if let Some(rest) = &params.rest {
            other_bindings(&rest.rest.argument, &mut bindings);
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
                    _ => other_bindings(&d.id, &mut bindings),
                }
            }
        }
        self.scopes.push(Scope {
            component,
            bindings,
        });
    }
}

/// The bindings of a component's first parameter. A property of an object
/// pattern bound to a plain name (with or without a default) reads the
/// call site's prop of that key, and so does `props.<key>` for a parameter
/// named `props`; nested patterns and rest elements are never editable.
fn parameter_bindings(
    pattern: &BindingPattern<'_>,
    component: &str,
    bindings: &mut Vec<(String, Binding)>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(id) if id.name == "props" => {
            bindings.push((
                id.name.to_string(),
                Binding::Props {
                    component: component.to_string(),
                },
            ));
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                let key = if property.computed {
                    None
                } else {
                    property.key.static_name()
                };
                let (id, default) = match &property.value {
                    BindingPattern::BindingIdentifier(id) => (Some(id), ParamDefault::None),
                    BindingPattern::AssignmentPattern(assign) => match &assign.left {
                        BindingPattern::BindingIdentifier(id) => {
                            (Some(id), default_of(&assign.right))
                        }
                        _ => (None, ParamDefault::None),
                    },
                    _ => (None, ParamDefault::None),
                };
                match (key, id) {
                    (Some(key), Some(id)) => bindings.push((
                        id.name.to_string(),
                        Binding::Parameter {
                            component: component.to_string(),
                            param: key.to_string(),
                            default,
                        },
                    )),
                    _ => other_bindings(&property.value, bindings),
                }
            }
            if let Some(rest) = &object.rest {
                other_bindings(&rest.argument, bindings);
            }
        }
        _ => other_bindings(pattern, bindings),
    }
}

fn other_bindings(pattern: &BindingPattern<'_>, bindings: &mut Vec<(String, Binding)>) {
    for id in pattern.get_binding_identifiers() {
        bindings.push((id.name.to_string(), Binding::Other));
    }
}

fn default_of(expr: &Expression<'_>) -> ParamDefault {
    match shape_of(expr) {
        Shape::Number(_, value) => ParamDefault::Literal(EditValue::Number(value)),
        Shape::String(_, value, _) => ParamDefault::Literal(EditValue::String(value)),
        Shape::Bool(_, value, _) => ParamDefault::Literal(EditValue::Bool(value)),
        _ => ParamDefault::Other,
    }
}

impl<'a> Visit<'a> for Gather<'_> {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        let pushed = self.encloses_element(it.span);
        if pushed && self.outer.is_none() {
            self.outer = Some(it.span);
        }
        if pushed {
            let name = it
                .id
                .as_ref()
                .map(|id| id.name.to_string())
                .or_else(|| self.named(it.span.start).map(str::to_string));
            self.push_scope(name, &it.params, it.body.as_deref());
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
            let name = self.named(it.span.start).map(str::to_string);
            self.push_scope(name, &it.params, body);
        }
        oxc_ast_visit::walk::walk_arrow_function_expression(self, it);
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        // Named before the function is visited.
        if let (Some(id), Some(init)) = (it.id.get_binding_identifier(), &it.init)
            && let Some(start) = component_function(init)
        {
            self.names.push((start, id.name.to_string()));
        }
        oxc_ast_visit::walk::walk_variable_declarator(self, it);
    }

    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        self.declarations.push((it.name.to_string(), it.span.start));
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        *self.refs.entry(it.name.to_string()).or_insert(0) += 1;
    }

    fn visit_jsx_element(&mut self, it: &JSXElement<'a>) {
        if it.opening_element.span.start == self.element_start && self.children.is_none() {
            self.children = Some(children_of(it));
        }
        oxc_ast_visit::walk::walk_jsx_element(self, it);
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
                        if name.name != self.path.attribute() {
                            continue;
                        }
                        if let PropPath::Style(key) = self.path {
                            self.property = Some(style_property(attr, key));
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
