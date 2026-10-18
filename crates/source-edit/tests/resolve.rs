use celesta_source_edit::{
    Edit, EditTarget, ElementRef, LockReason, ResolveContext, Span, apply, element_at,
    has_attribute, resolve,
};

fn ctx() -> ResolveContext {
    ResolveContext {
        primitive: true,
        local_frame: 0.0,
        received: None,
        render_count: 1,
    }
}

fn with_received(received: f64) -> ResolveContext {
    ResolveContext {
        received: Some(received),
        ..ctx()
    }
}

/// Resolves `prop` on the first `<Rect` in `text` (ASCII only).
fn run(text: &str, prop: &str, ctx: &ResolveContext) -> EditTarget {
    let offset = text.find("<Rect").unwrap();
    let before = &text[..offset];
    let line = before.matches('\n').count() as u32 + 1;
    let column = (offset - before.rfind('\n').map_or(0, |i| i + 1)) as u32 + 1;
    let element = element_at(text, line, column).unwrap();
    resolve(text, &element, prop, ctx)
}

fn component(body: &str) -> String {
    format!("export const A = () => {{\n{body}\n}};\n")
}

fn span_text(text: &str, span: Span) -> &str {
    &text[span.start as usize..span.end as usize]
}

fn locked(reason: LockReason) -> EditTarget {
    EditTarget::Locked(reason)
}

#[test]
fn not_primitive_locks() {
    let text = component("  return <Rect x={1} />;");
    let c = ResolveContext {
        primitive: false,
        ..ctx()
    };
    assert_eq!(run(&text, "x", &c), locked(LockReason::NotPrimitive));
}

#[test]
fn repeated_locks() {
    let text = component("  return <Rect x={1} />;");
    let c = ResolveContext {
        render_count: 12,
        ..ctx()
    };
    assert_eq!(
        run(&text, "x", &c),
        locked(LockReason::Repeated { count: 12 })
    );
}

#[test]
fn syntax_error_locks() {
    let text = "export const A = () => {\n  return <Rect x={1} />;\n  const = ;\n};\n";
    // The recovered AST may not even contain the element; build the ref by hand.
    let start = text.find("<Rect").unwrap() as u32;
    let element = ElementRef {
        start,
        end_of_attributes: text.find(" />").unwrap() as u32,
    };
    assert_eq!(
        resolve(text, &element, "x", &with_received(1.0)),
        locked(LockReason::SyntaxError)
    );
}

#[test]
fn missing_inserts_default() {
    let text = component("  return <Rect width={1} />;");
    let at = text.find(" />").unwrap() as u32;
    assert_eq!(
        run(&text, "x", &ctx()),
        EditTarget::Missing {
            insert_at: at,
            default: 0.0
        }
    );
    assert_eq!(
        run(&text, "scale", &ctx()),
        EditTarget::Missing {
            insert_at: at,
            default: 1.0
        }
    );
}

#[test]
fn missing_with_spread_locks() {
    let text = component("  return <Rect {...p} />;");
    assert_eq!(run(&text, "x", &ctx()), locked(LockReason::Spread));

    let text = component("  return <Rect {...p} x={3} />;");
    let target = run(&text, "x", &with_received(3.0));
    let EditTarget::Literal { span, value } = target else {
        panic!("expected Literal, got {target:?}");
    };
    assert_eq!((span_text(&text, span), value), ("3", 3.0));
}

#[test]
fn literal() {
    let text = component("  return <Rect x={120} />;");
    let target = run(&text, "x", &with_received(120.0));
    let EditTarget::Literal { span, value } = target else {
        panic!("expected Literal, got {target:?}");
    };
    assert_eq!((span_text(&text, span), value), ("120", 120.0));

    let text = component("  return <Rect x={-12} />;");
    let target = run(&text, "x", &with_received(-12.0));
    let EditTarget::Literal { span, value } = target else {
        panic!("expected Literal, got {target:?}");
    };
    assert_eq!((span_text(&text, span), value), ("-12", -12.0));
}

#[test]
fn const_literal() {
    let text = component("  const X = 40;\n  return <Rect x={X} />;");
    let target = run(&text, "x", &with_received(40.0));
    let EditTarget::Literal { span, value } = target else {
        panic!("expected Literal, got {target:?}");
    };
    assert_eq!((span_text(&text, span), value), ("40", 40.0));
}

#[test]
fn const_shared() {
    let text = component("  const X = 40;\n  return <Group><Rect x={X} /><Rect x={X} /></Group>;");
    assert_eq!(
        run(&text, "x", &with_received(40.0)),
        locked(LockReason::SharedBinding {
            name: "X".into(),
            uses: 2
        })
    );
}

#[test]
fn let_or_param_unresolved() {
    let text = component("  let X = 4;\n  return <Rect x={X} />;");
    assert_eq!(
        run(&text, "x", &with_received(4.0)),
        locked(LockReason::UnresolvedIdentifier { name: "X".into() })
    );

    let text = "export const A = ({ X }) => {\n  return <Rect x={X} />;\n};\n";
    assert_eq!(
        run(text, "x", &with_received(4.0)),
        locked(LockReason::UnresolvedIdentifier { name: "X".into() })
    );

    let text = "export function A(X: number) {\n  return <Rect x={X} />;\n}\n";
    assert_eq!(
        run(text, "x", &with_received(4.0)),
        locked(LockReason::UnresolvedIdentifier { name: "X".into() })
    );
}

#[test]
fn module_level_const_unresolved() {
    let text = "const X = 40;\nexport const A = () => {\n  return <Rect x={X} />;\n};\n";
    assert_eq!(
        run(text, "x", &with_received(40.0)),
        locked(LockReason::UnresolvedIdentifier { name: "X".into() })
    );
}

#[test]
fn inner_binding_shadows_outer_const() {
    let text = "export const A = () => {\n  const X = 40;\n  const B = (X: number) => <Rect x={X} />;\n  return B(1);\n};\n";
    assert_eq!(
        run(text, "x", &with_received(40.0)),
        locked(LockReason::UnresolvedIdentifier { name: "X".into() })
    );
}

#[test]
fn expression_locks() {
    let text = component("  return <Rect x={W / 2} />;");
    assert_eq!(
        run(&text, "x", &with_received(5.0)),
        locked(LockReason::Expression {
            source: "W / 2".into()
        })
    );
}

#[test]
fn overridden_by_parent() {
    let text = component("  return <Rect x={120} />;");
    assert_eq!(
        run(&text, "x", &with_received(80.0)),
        locked(LockReason::OverriddenByParent)
    );

    let text = component("  return <Rect width={1} />;");
    assert_eq!(
        run(&text, "x", &with_received(5.0)),
        locked(LockReason::OverriddenByParent)
    );
}

#[test]
fn to_edit_rejects_non_finite_values() {
    let text = component("  return <Rect x={120} />;");
    let target = run(&text, "x", &with_received(120.0));
    assert!(target.to_edit("x", f64::NAN).is_none());
    assert!(target.to_edit("x", f64::INFINITY).is_none());
    assert!(locked(LockReason::Spread).to_edit("x", 1.0).is_none());
}

#[test]
fn to_edit_round_trips_through_apply() {
    let text = component("  return <Rect x={120} width={1} />;");
    let literal = run(&text, "x", &with_received(120.0));
    let missing = run(&text, "y", &ctx());
    let edits: Vec<Edit> = [
        literal.to_edit("x", 130.5).unwrap(),
        missing.to_edit("y", 7.0).unwrap(),
    ]
    .into();
    assert_eq!(
        apply(&text, &edits).unwrap(),
        component("  return <Rect x={130.5} width={1} y={7} />;")
    );
}

const FRAME: &str = "  const frame = useCurrentFrame();\n";

fn animated(frame_line: &str, attr: &str) -> String {
    component(&format!("{FRAME}{frame_line}  return <Rect {attr} />;"))
}

fn at_frame(local_frame: f64, received: Option<f64>) -> ResolveContext {
    ResolveContext {
        local_frame,
        received,
        ..ctx()
    }
}

#[test]
fn keyframe_hit() {
    let text = animated("", "x={interpolate(frame, [0, 30], [100, 400])}");
    let target = run(&text, "x", &at_frame(30.0, Some(400.0)));
    let EditTarget::Keyframe { span, value, frame } = target else {
        panic!("expected Keyframe, got {target:?}");
    };
    assert_eq!((span_text(&text, span), value, frame), ("400", 400.0, 30.0));
}

#[test]
fn keyframe_via_const() {
    let text = animated(
        "  const x = interpolate(frame, [0, 30], [100, 400], { easing: Easings.easeOut });\n",
        "x={x}",
    );
    let target = run(&text, "x", &at_frame(0.0, Some(100.0)));
    let EditTarget::Keyframe { span, value, .. } = target else {
        panic!("expected Keyframe, got {target:?}");
    };
    assert_eq!((span_text(&text, span), value), ("100", 100.0));
}

#[test]
fn keyframe_via_shared_const_locks() {
    let text = component(&format!(
        "{FRAME}  const x = interpolate(frame, [0, 30], [100, 400]);\n  return <Group><Rect x={{x}} /><Rect x={{x}} /></Group>;"
    ));
    assert_eq!(
        run(&text, "x", &at_frame(0.0, Some(100.0))),
        locked(LockReason::SharedBinding {
            name: "x".into(),
            uses: 2
        })
    );
}

#[test]
fn keyframe_offset() {
    let text = animated("", "x={interpolate(frame - 30, [0, 10], [0, 50])}");
    let target = run(&text, "x", &at_frame(40.0, Some(50.0)));
    let EditTarget::Keyframe { span, value, frame } = target else {
        panic!("expected Keyframe, got {target:?}");
    };
    assert_eq!((span_text(&text, span), value, frame), ("50", 50.0, 40.0));
}

#[test]
fn between() {
    let text = animated("", "x={interpolate(frame, [0, 30], [100, 400])}");
    assert_eq!(
        run(&text, "x", &at_frame(15.0, Some(250.0))),
        locked(LockReason::BetweenKeyframes {
            previous: 0.0,
            next: 30.0
        })
    );

    let text = animated("", "x={interpolate(frame - 30, [0, 10], [0, 50])}");
    assert_eq!(
        run(&text, "x", &at_frame(35.0, Some(25.0))),
        locked(LockReason::BetweenKeyframes {
            previous: 30.0,
            next: 40.0
        })
    );
}

#[test]
fn outside() {
    let text = animated("", "x={interpolate(frame, [0, 30], [100, 400])}");
    assert_eq!(
        run(&text, "x", &at_frame(45.0, Some(400.0))),
        locked(LockReason::OutsideKeyframes)
    );
    assert_eq!(
        run(&text, "x", &at_frame(-5.0, Some(100.0))),
        locked(LockReason::OutsideKeyframes)
    );
}

#[test]
fn computed_range() {
    let source = "interpolate(frame, range, [100, 400])";
    let text = animated("", &format!("x={{{source}}}"));
    assert_eq!(
        run(&text, "x", &at_frame(0.0, Some(100.0))),
        locked(LockReason::Expression {
            source: source.into()
        })
    );

    // Mismatched lengths and non-literal entries are not editable either.
    let source = "interpolate(frame, [0, 30], [100])";
    let text = animated("", &format!("x={{{source}}}"));
    assert_eq!(
        run(&text, "x", &at_frame(0.0, Some(100.0))),
        locked(LockReason::Expression {
            source: source.into()
        })
    );
}

#[test]
fn input_not_frame() {
    let source = "interpolate(progress, [0, 30], [100, 400])";
    let text = animated("", &format!("x={{{source}}}"));
    assert_eq!(
        run(&text, "x", &at_frame(0.0, Some(100.0))),
        locked(LockReason::Expression {
            source: source.into()
        })
    );

    // `frame` bound to something other than `useCurrentFrame()`.
    let source = "interpolate(frame, [0, 30], [100, 400])";
    let text = component(&format!(
        "  const frame = 3;\n  return <Rect x={{{source}}} />;"
    ));
    assert_eq!(
        run(&text, "x", &at_frame(0.0, Some(100.0))),
        locked(LockReason::Expression {
            source: source.into()
        })
    );
}

#[test]
fn spring_locks() {
    let text = animated("  const fps = 30;\n", "x={spring({ frame, fps })}");
    assert_eq!(
        run(&text, "x", &at_frame(0.0, Some(0.0))),
        locked(LockReason::UnsupportedCall {
            callee: "spring".into()
        })
    );
}

#[test]
fn keyframe_overridden() {
    let text = animated("", "x={interpolate(frame, [0, 30], [100, 400])}");
    assert_eq!(
        run(&text, "x", &at_frame(30.0, Some(390.0))),
        locked(LockReason::OverriddenByParent)
    );
}

#[test]
fn has_attribute_ignores_spreads_and_absent_props() {
    let text = component("return <Rect {...rest} scaleX={W / 2} x={1} />;");
    let offset = text.find("<Rect").unwrap();
    let element = ElementRef {
        start: offset as u32,
        end_of_attributes: 0,
    };

    assert!(has_attribute(&text, &element, "scaleX"));
    assert!(has_attribute(&text, &element, "x"));
    assert!(!has_attribute(&text, &element, "scaleY"));
    assert!(!has_attribute(&text, &element, "rest"));
}
