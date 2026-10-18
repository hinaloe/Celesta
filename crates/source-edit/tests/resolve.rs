use celesta_source_edit::{
    Edit, EditTarget, ElementRef, LockReason, ResolveContext, Span, apply, element_at, resolve,
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
