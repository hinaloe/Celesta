//! Tests of editing a text on the canvas (`inline_text_view`): entering an
//! edit, what ends it, and a press placing the caret.

use super::*;
use crate::element_edit::{editable, inner_target};
use crate::inline_text::TextMap;
use crate::inline_text_view::{
    EditEnd, EditEvent, InlineEntry, InlineTextSession, cancel_session, edit_end, inline_entry,
    live_override, pressed_index,
};
use crate::preview::TextOverride;
use crate::transform_drag::{DragState, editing_drag_state};
use celesta_composition::TextAlign;
use celesta_gpu_renderer::{GlyphMetrics, TextLayout, TextMetrics};
use gpui_kit::{Bounds, point, px, size};

fn at(x: f64, y: f64) -> Point {
    Point { x, y }
}

/// A 40 by 20 box at the scene's origin, as the renderer records an
/// untransformed one-line text's layout box.
fn flat_box() -> [Point; 4] {
    [at(0.0, 0.0), at(40.0, 0.0), at(40.0, 20.0), at(0.0, 20.0)]
}

/// The `<Text>` at `line`:`column` of `text`, resolved with the Text table
/// and received with `received` as its children.
fn text_at(
    text: &str,
    (line, column): (u32, u32),
    received: &str,
) -> (ElementTargets, LayerSourceReport) {
    let mut report = text_report(
        Path::new("/project/scene.tsx"),
        &[("children", ReceivedValue::String(received.to_owned()))],
    );
    report.chain[0].line = line;
    report.chain[0].column = column;
    let targets = resolve_table(text, &report, &text_table());
    (targets, report)
}

/// [`text_at`] for a `<Text>` at line 2, column 3.
fn text_targets(text: &str, received: &str) -> (ElementTargets, LayerSourceReport) {
    text_at(text, (2, 3), received)
}

fn children_target(targets: &ElementTargets) -> &EditTarget {
    targets
        .target(&prop("children"))
        .expect("a Text has a text row")
}

/// The entry for editable targets drawn in `flat_box`, nothing pending.
fn enter(targets: &ElementTargets, report: &LayerSourceReport) -> InlineEntry {
    inline_entry(
        Some((targets, report)),
        false,
        None,
        false,
        Some(flat_box()),
        None,
    )
}

#[test]
fn inline_entry_takes_the_received_children() {
    // A literal.
    let (targets, report) = text_targets(
        "export const Scene = () => (\n  <Text>Sale</Text>\n);\n",
        "Sale",
    );
    assert!(editable(children_target(&targets)));
    assert_eq!(
        enter(&targets, &report),
        InlineEntry::Begin("Sale".to_owned())
    );

    // A const the children read.
    let (targets, report) = text_at(
        "export const Scene = () => {\n  const LABEL = \"Sale\";\n  return <Text>{LABEL}</Text>;\n};\n",
        (3, 10),
        "Sale",
    );
    let children = children_target(&targets);
    assert!(editable(children), "{children:?}");
    assert_eq!(
        enter(&targets, &report),
        InlineEntry::Begin("Sale".to_owned())
    );

    // Passed through from the call site: `<Label text="Sale" />`.
    let texts = Texts::from([
        (
            PathBuf::from("/project/component.tsx"),
            "export function Label({ text }) {\n  return <Text>{text}</Text>;\n}\n".to_owned(),
        ),
        (
            PathBuf::from("/project/scene.tsx"),
            "export const Scene = () => (\n  <Label text=\"Sale\" />\n);\n".to_owned(),
        ),
    ]);
    let mut report = text_report(
        Path::new("/project/component.tsx"),
        &[("children", ReceivedValue::String("Sale".to_owned()))],
    );
    report.chain[0].column = 10;
    report.chain.push(entry_at(
        "Label",
        ElementKind::Component,
        "/project/scene.tsx",
        2,
    ));
    let targets = resolve_targets(read_from(&texts), &report, Some(&text_table())).unwrap();
    let children = children_target(&targets);
    assert!(matches!(children, EditTarget::PassThrough { .. }));
    assert!(editable(children));
    assert_eq!(
        enter(&targets, &report),
        InlineEntry::Begin("Sale".to_owned())
    );

    // Nothing written between the tags, nothing passed: an empty edit that
    // inserts the text.
    let report = text_report(Path::new("/project/scene.tsx"), &[]);
    let targets = resolve_table(
        "export const Scene = () => (\n  <Text></Text>\n);\n",
        &report,
        &text_table(),
    );
    let children = children_target(&targets);
    assert!(
        matches!(children, EditTarget::Missing { .. }),
        "{children:?}"
    );
    assert_eq!(enter(&targets, &report), InlineEntry::Begin(String::new()));
}

#[test]
fn inline_entry_waits_for_a_pending_lookup() {
    let still_reading = Some("The source is still being read");
    assert_eq!(
        inline_entry(None, true, still_reading, false, Some(flat_box()), None),
        InlineEntry::Wait
    );
    // The text box isn't known to matter yet: the lookup decides first.
    assert_eq!(
        inline_entry(None, true, still_reading, false, None, None),
        InlineEntry::Wait
    );
    // Answered without targets: the reason the rows can't be written.
    assert_eq!(
        inline_entry(None, false, Some("No source position"), false, None, None),
        InlineEntry::Refuse("No source position".to_owned())
    );
}

#[test]
fn inline_entry_refuses_a_locked_row_with_its_reason() {
    for (text, shown) in [
        (
            "export const Scene = () => (\n  <Text><Span>Sale</Span></Text>\n);\n",
            "<Span>Sale</Span>",
        ),
        (
            "export const Scene = () => (\n  <Text>{\"Sale\" + \"!\"}</Text>\n);\n",
            "\"Sale\" + \"!\"",
        ),
    ] {
        let (targets, report) = text_targets(text, "Sale");
        let EditTarget::Locked(reason) = inner_target(children_target(&targets)) else {
            panic!("{text}: the text row is locked");
        };
        let reason = reason_text(reason);
        assert!(reason.contains(shown), "{reason}");
        assert_eq!(enter(&targets, &report), InlineEntry::Refuse(reason));
    }
}

#[test]
fn inline_entry_refuses_while_the_code_reloads() {
    let (targets, report) = text_targets(
        "export const Scene = () => (\n  <Text>Sale</Text>\n);\n",
        "Sale",
    );
    let reloading = InlineEntry::Refuse("The code is reloading".to_owned());
    assert_eq!(
        inline_entry(
            Some((&targets, &report)),
            false,
            None,
            true,
            Some(flat_box()),
            None
        ),
        reloading
    );
    // Not waited for either: the reload answers the lookup again.
    assert_eq!(
        inline_entry(None, true, None, true, Some(flat_box()), None),
        reloading
    );
}

#[test]
fn inline_entry_refuses_a_text_that_isn_t_drawn() {
    let (targets, report) = text_targets(
        "export const Scene = () => (\n  <Text>Sale</Text>\n);\n",
        "Sale",
    );
    assert_eq!(
        inline_entry(Some((&targets, &report)), false, None, false, None, None),
        InlineEntry::Refuse("The text isn't drawn in this frame".to_owned())
    );
}

#[test]
fn inline_entry_refuses_an_edge_on_text() {
    let (targets, report) = text_targets(
        "export const Scene = () => (\n  <Text>Sale</Text>\n);\n",
        "Sale",
    );
    let edge_on = InlineEntry::Refuse("The text is edge-on to the view".to_owned());
    // Turned 90° about its vertical axis: no width on screen.
    let flat = [at(20.0, 0.0), at(20.0, 0.0), at(20.0, 20.0), at(20.0, 20.0)];
    // Turned past it far enough to cross over: a bow-tie.
    let crossed = [at(0.0, 0.0), at(40.0, 20.0), at(40.0, 0.0), at(0.0, 20.0)];
    let layout = one_line("Sale");
    for text_box in [flat, crossed] {
        for layout in [None, Some(&layout)] {
            assert_eq!(
                inline_entry(
                    Some((&targets, &report)),
                    false,
                    None,
                    false,
                    Some(text_box),
                    layout
                ),
                edge_on
            );
        }
    }
    // A mirrored box, its corners in reverse, is not edge-on.
    let mirrored = [at(40.0, 0.0), at(0.0, 0.0), at(0.0, 20.0), at(40.0, 20.0)];
    assert_eq!(
        inline_entry(
            Some((&targets, &report)),
            false,
            None,
            false,
            Some(mirrored),
            Some(&layout)
        ),
        InlineEntry::Begin("Sale".to_owned())
    );
}

#[test]
fn edit_end_decides_every_event() {
    let changed = Some("The source changed while editing");
    assert_eq!(
        edit_end(EditEvent::Enter),
        EditEnd::Commit { refocus_root: true }
    );
    assert_eq!(
        edit_end(EditEvent::Escape),
        EditEnd::Cancel {
            reason: None,
            refocus_root: true
        }
    );
    // The focus went where the user put it.
    assert_eq!(
        edit_end(EditEvent::Blur),
        EditEnd::Commit {
            refocus_root: false
        }
    );
    // A press in the text places the caret; outside, it commits and then
    // acts as usual.
    assert_eq!(
        edit_end(EditEvent::CanvasPress { inside: true }),
        EditEnd::Keep
    );
    assert_eq!(
        edit_end(EditEvent::CanvasPress { inside: false }),
        EditEnd::Commit { refocus_root: true }
    );
    assert_eq!(
        edit_end(EditEvent::SelectionCleared {
            outside_change: true
        }),
        EditEnd::Cancel {
            reason: changed,
            refocus_root: true
        }
    );
    assert_eq!(
        edit_end(EditEvent::SelectionCleared {
            outside_change: false
        }),
        EditEnd::Cancel {
            reason: None,
            refocus_root: true
        }
    );
    // The rest come by a key or a menu with the focus still on the text
    // (a press elsewhere blurs it first), so the root takes it back.
    for event in [
        EditEvent::SelectionChange,
        EditEvent::ToggleInteractive,
        EditEvent::Seek,
        EditEvent::Play,
        EditEvent::ProjectCommand,
    ] {
        assert_eq!(
            edit_end(event),
            EditEnd::Commit { refocus_root: true },
            "{event:?}"
        );
    }
}

#[test]
fn editing_drag_state_hides_handles_and_cross() {
    let frame = || drag_frame([1.0, 0.0, 0.0, 1.0, 0.0, 0.0], at(10.0, 20.0));
    let editable = || DragState::Editable(frame(), vec![prop("x")], PivotMode::Pivot, None);
    let locked = || DragState::Locked(frame(), "Written as an expression: x".to_owned());
    // Editing: the outline only.
    assert!(matches!(
        editing_drag_state(editable(), true),
        DragState::Unknown
    ));
    assert!(matches!(
        editing_drag_state(locked(), true),
        DragState::Unknown
    ));
    assert!(matches!(
        editing_drag_state(DragState::NoFrame, true),
        DragState::Unknown
    ));
    // Otherwise as it was.
    assert!(matches!(
        editing_drag_state(editable(), false),
        DragState::Editable(_, props, PivotMode::Pivot, None) if props == [prop("x")]
    ));
    assert!(matches!(
        editing_drag_state(locked(), false),
        DragState::Locked(_, reason) if reason == "Written as an expression: x"
    ));
    assert!(matches!(
        editing_drag_state(DragState::NoFrame, false),
        DragState::NoFrame
    ));
}

/// `text` on one line, each code point a 10-wide cluster, 20 high.
fn one_line(text: &str) -> TextLayout {
    let glyphs: Vec<GlyphMetrics> = text
        .chars()
        .enumerate()
        .map(|(index, c)| GlyphMetrics {
            start: index,
            end: index + 1,
            rtl: false,
            text: c.to_string(),
            x: 10.0 * index as f64,
            width: 10.0,
            line: 0,
            ink_ascent: 0.0,
            ink_descent: 0.0,
        })
        .collect();
    TextLayout {
        text: text.to_owned(),
        metrics: TextMetrics {
            line_starts: vec![0],
            width: 10.0 * glyphs.len() as f64,
            height: 20.0,
            ascent: 16.0,
            descent: 4.0,
            line_height: 20.0,
            lines: 1,
            glyphs,
            ..TextMetrics::default()
        },
        max_width: None,
        align: TextAlign::Left,
    }
}

#[test]
fn a_press_in_the_layout_box_places_the_caret() {
    // A 400 by 200 frame fitted at half size into a viewer at (100, 50).
    let bounds = Bounds::new(point(px(100.0), px(50.0)), size(px(200.0), px(100.0)));
    let frame_size = (400.0, 200.0);
    let on_screen = |scene: Point| {
        point(
            px(100.0 + scene.x as f32 * 0.5),
            px(50.0 + scene.y as f32 * 0.5),
        )
    };
    let layout = one_line("abcd");
    let moved = |p: Point| at(p.x + 100.0, p.y + 100.0);
    // Drawn flat at (100, 100), and tilted back under a perspective (its
    // top edge shorter).
    let flat = flat_box().map(moved);
    let tilted = [at(10.0, 0.0), at(30.0, 0.0), at(40.0, 20.0), at(0.0, 20.0)].map(moved);
    for text_box in [flat, tilted] {
        let map = TextMap::fit(&layout, text_box).unwrap();
        let press = |x: f64, y: f64| {
            let position = on_screen(map.to_scene(at(x, y)));
            pressed_index(bounds, frame_size, position, &layout, &map)
        };
        // Nearer the boundary between "c" and "d" than any other.
        assert_eq!(press(27.0, 10.0), Some((3, false)));
        assert_eq!(press(2.0, 18.0), Some((0, false)));
        assert_eq!(press(39.0, 1.0), Some((4, false)));
        // Outside the layout box: no caret, the press commits.
        assert_eq!(press(45.0, 10.0), None);
        assert_eq!(press(20.0, -3.0), None);
        assert_eq!(press(20.0, 23.0), None);
    }
}

#[test]
fn escape_after_marking_drops_the_session_and_its_override() {
    let mut session = InlineTextSession::new("title".to_owned(), "Sale".to_owned());
    session.edit.insert("!");
    session.edit.mark_utf16(None, "に", None);
    let live = live_override(&session);
    assert_eq!(
        live,
        TextOverride {
            layer: "title".to_owned(),
            original: "Sale".to_owned(),
            text: "Sale!に".to_owned(),
        }
    );
    let mut session = Some(session);
    let mut text_override = Some(live);

    let EditEnd::Cancel { reason, .. } = edit_end(EditEvent::Escape) else {
        panic!("Escape cancels");
    };
    assert_eq!(reason, None);
    assert!(cancel_session(&mut session, &mut text_override));
    // No session, and the next frame draws the code's own text.
    assert!(session.is_none());
    assert_eq!(text_override, None);
    // Nothing more to cancel.
    assert!(!cancel_session(&mut session, &mut text_override));

    // Another layer's override (a commit waiting for its reload) stays.
    let mut session = Some(InlineTextSession::new(
        "title".to_owned(),
        "Sale".to_owned(),
    ));
    let other = TextOverride {
        layer: "price".to_owned(),
        original: "$5".to_owned(),
        text: "$4".to_owned(),
    };
    let mut text_override = Some(other.clone());
    assert!(cancel_session(&mut session, &mut text_override));
    assert_eq!(text_override, Some(other));
}
