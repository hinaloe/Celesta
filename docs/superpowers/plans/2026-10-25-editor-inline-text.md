# Inline Text Editing (Design 2d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-clicking a `Text` layer whose children resolve to an editable string edits the text in place on the canvas, in its own font, size, wrapping and transform, with caret, selection, clipboard and IME (Japanese input), and commits it as one history entry.

**Architecture:** The preview worker keeps the last scene the React runtime evaluated, so a keystroke re-renders it with the edited layer's text replaced, without running the code, and returns the layer's `TextMetrics` with the frame. A pure module (`inline_text.rs`) holds the edit (text, selection, marked text) and turns the metrics into caret, selection and hit-test geometry in the layer's own pixels; the viewer maps them to the screen through `canvas_geometry` as the handles are, paints them, and is GPUI's input handler for the edit. Commit goes through the Properties tab's `text` row path.

**Tech Stack:** Rust (`celesta-editor` with GPUI via gpui-kit 0.6 / gpui-pre 0.3.6, `celesta-gpu-renderer`, `celesta-renderer`, `celesta-composition`), docs in the website package.

**Spec:** `docs/superpowers/specs/2026-10-23-editor-property-editing-design.md`, section "Inline text editing" and the 2d lines of "Testing". Builds on 2b (`text` row, `commit_element_row`, `HeldCommits`, `SelectionGate`, `submit_requested`) and 2c (`canvas_geometry`, `LayerFrame.anchor_box`, the tool row).

| Part | Plan | Spec sections |
| --- | --- | --- |
| 2a | engine (#516) | |
| 2b | Properties sections (#525, #526) | |
| 2c | canvas tools (#530) | Canvas: Pivot, Resize |
| 2d | this plan | Canvas: Inline text editing |

## Global Constraints

- One commit is one history entry, through the `text` row's path (`commit_element_row` for `PropKey::Prop("children")`): re-resolve, "The source changed while editing", the re-parse check, held while a write or reload runs. Nothing else writes the source.
- Nothing is written while typing, and the React code is not run for a keystroke: what the code computes from the text keeps its old size until the commit's reload (spec, decided with the user).
- Design 3 (edit scope) is not built: a shared element's text is committed exactly as the Properties tab's `text` row commits it today. Design 3 adds the scope later.
- Indices: the edit holds code-point indices, as `TextMetrics.line_starts` and `GlyphMetrics.start`/`end` do; UTF-16 only at GPUI's input handler, bytes only inside `String` operations.
- UI copy English, inspector style (radius 0 except the 2c tabs, no gradients, no uppercase labels, lucide icons via `CelestaIcon`/`IconName`).
- TDD per task; red/green runs only the new tests; each crate's suite once per task; `cargo clippy -p celesta-editor -p celesta-gpu-renderer --all-targets` clean (the pre-existing `large_enum_variant` on `SourceLookup` excepted); `cargo fmt --check`.
- No `git commit --amend`; commit and test commands are separate calls; stage paths explicitly (never `examples/feature-tour/` or `docs/superpowers/.DS_Store`).

## Rulings (decided here; the spec leaves them open)

- **The line box origin comes from the renderer.** A single-line text's anchor box is trimmed to its ink, so `anchor_box` does not give the line top. The renderer records each text's first baseline across its layout box (`first_baseline`, scene pixels, like `anchor_box`); in own pixels its left end is the layout box's left edge and line `i`'s top is `baseline − ascent + i · line_height`.
- **Flat text only.** Caret geometry uses `canvas_geometry`'s affine map. A `Text` without a `LayerFrame` (an ancestor turns in 3D or has a perspective) or drawn through its own perspective is refused on double-click with "No flat box to edit on".
- **The edit starts from the received `children`** (`report.props`), which is what the code passed to `<Text>`; the live render shows it unchanged until a key is pressed.
- **The live text replaces the layer's string only.** `color_runs`, `font_runs` and `visible_characters` index the old text and are cleared on the edited layer while editing (a shorter text would make `InvalidTextColorRun`); the commit's reload restores whatever the code computes.
- **Arrow keys move by grapheme cluster** (`unicode-segmentation`); geometry interpolates a caret inside a shaping cluster that spans several graphemes (a ligature). An RTL glyph's leading edge is its right edge.
- **Soft wraps have an affinity.** The index at a wrapped line's start draws at the next line's start, except after End or a click past a line's end, which draw it at the end of the line before (`upstream`); any other move clears it. An empty line's caret sits at its alignment's x (left 0, center W/2, right W of the layout width).
- **Keys.** The editing element has key context `"Input CanvasText"`: gpui-base's Input bindings apply and the editor's `!Input` shortcuts don't. Enter and Cmd+Enter commit, Shift+Enter inserts `\n`, Escape cancels, Cmd+Z/Cmd+Shift+Z are swallowed (no undo inside an edit), Tab does nothing. Shift+arrows (not re-exported by gpui-kit) are handled in `capture_key_down`. Pasted text is plain, `\r\n` and `\r` become `\n`.
- **Caret is steady** (no blink), 1 px in the accent color, mapped as a segment so it slants with rotated text; the selection is the accent at 30% alpha; marked (IME) text is underlined 1 px at its line's bottom.
- **Commit.** Unchanged text leaves without writing. An empty text leaves without writing (the `text` row is required: an emptied field shows the source again). Otherwise the row commit runs, and the edited layer's override stays on every preview request until the reload's frame is shown (as a released drag's), or is dropped when the commit fails (its error shows in the viewer's notice).
- **Ending.** Enter, a canvas press outside the layout box (it commits, then the press acts as usual), blur of the editing element (a click in the Properties tab, the layer list, the tool row), selecting another layer, toggling Select layers, seeking and starting playback commit. Escape cancels. An outside change to the source cancels with "The source changed while editing" (the viewer's notice). An own write's reload keeps the edit.
- **Exclusive with the Properties `Text` row**: while editing, that row is disabled and reads "Editing on the canvas"; scrubs and canvas drags don't start.
- **Refusal.** Double-clicking a `Text` whose `text` row is locked or unavailable shows the reason (`reason_text`, or `element_edit.unavailable`) in a note beside the layer, styled as the drag label, until the next press or selection change; editing does not start.

## Review Focus

- **A single-line text with anchor (0.5, 0.5)**: the caret's top and bottom are the line box's, not the ink's. Test in Task 1 (renderer) and Task 3 (geometry).
- **A `Text` with `visibleCharacters` or color runs**: typing past the old length renders without `InvalidTextColorRun`. Test in Task 2.
- **IME composition then Escape**: the marked text is dropped and the scene shows the original text. Test in Task 3 (edit model) and Task 5 (lifecycle).
- **RTL glyphs** (`GlyphMetrics.rtl`): the caret before an RTL cluster is at its right edge. Test in Task 3.
- **Pass-through `children`** (`<Label text="Sale" />`): the live override is by layer id, the commit writes the call site, one undo restores it. Test in Task 5.

---

### Task 1: Text metrics and the first baseline from the renderer

**Files:**
- Modify: `crates/gpu-renderer/src/{lib.rs,renderer.rs,hit.rs,layer_frame.rs,prepare.rs}` (and wherever `HitRegion`s are built for text)
- Test: `crates/gpu-renderer/src/tests.rs`, `crates/gpu-renderer/src/layer_frame.rs` tests

**Interfaces:**
- Produces:

```rust
pub use celesta_renderer::{GlyphMetrics, TextMetrics}; // re-exported from celesta-gpu-renderer
#[derive(Clone, Debug, PartialEq)]
pub struct TextLayout {
    pub text: String,          // the text it was laid out for
    pub metrics: TextMetrics,
    pub max_width: Option<f64>,
    pub align: TextAlign,      // style.align, Left when unset
}
impl GpuRenderer {
    /// Lays `text` out as the last rendered frame's fonts do (call after a render).
    pub fn measure_text(&mut self, text: &str, style: &TextStyle, max_width: Option<f64>) -> TextMetrics;
    /// The layout of text layer `layer` of `scene` (through groups and masks), measured
    /// as `measure_text` does; None when there is no such text layer.
    pub fn text_layout(&mut self, scene: &Scene, layer: &str) -> Option<TextLayout>;
}
// HitRegion and LayerFrame gain, for a text layer (None for every other):
/// The first line's baseline across the layout box, left end then right end, in scene pixels.
pub first_baseline: Option<[Point; 2]>,
```

- [ ] **Step 1: Write the failing tests** — `measure_text_matches_the_rendered_layout` (width/height equal the text size the frame used); `text_layout_finds_a_text_inside_a_group` (and None for a rect or a missing id); `a_text_s_first_baseline_runs_across_its_layout_box` (multi-line, anchor (0,0): left end = anchor box top-left + ascent down, right end = top-right + ascent down); `a_baseline_anchored_text_s_first_baseline_is_its_position`; `a_single_line_text_s_first_baseline_is_under_its_cap_height` (anchor (0.5, 0.5), "HHH": ink rows lie within `[baseline − cap_height − 1, baseline + 1]` at the glyphs' columns); `layer_frame_carries_the_first_baseline` (rotated parent group: the frame's points equal the region's).
- [ ] **Step 2: Run them, expect FAIL** — `cargo test -p celesta-gpu-renderer first_baseline measure_text`
- [ ] **Step 3: Implement** — `measure_text` wraps `text_rasterizer.measure`; the baseline comes from the texture's baseline anchor (`LayerTexture.baseline_anchor`/`anchor_origin`, `prepare.rs` text placement) mapped like `anchor_box`. Add `celesta-renderer` to the editor's dependencies only if the re-export is not enough.
- [ ] **Step 4: Run them, expect PASS**; then `cargo test -p celesta-gpu-renderer`.
- [ ] **Step 5: Commit** — `feat(gpu-renderer): measure text and record a text's first baseline`

### Task 2: The held scene and the live text override

**Files:**
- Modify: `crates/editor/src/preview.rs`, `crates/editor/src/refresh.rs` (request building), `crates/editor/src/background.rs` (result)
- Test: `crates/editor/src/preview.rs` `#[cfg(test)]`

**Interfaces:**
- Consumes: Task 1's `GpuRenderer::text_layout`, `TextLayout`, `LayerFrame.first_baseline`.
- Produces:

```rust
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TextOverride { pub(crate) layer: String, pub(crate) text: String }
// PreviewRequest gains:
pub(crate) text_override: Option<TextOverride>,
/// Render the scene the runtime last evaluated instead of evaluating again.
pub(crate) reuse_scene: bool,
// PreviewResult gains: pub(crate) text_layout: Option<TextLayout>, // the overridden layer's
/// Replaces layer `layer`'s text (through groups and masks), clearing its
/// color runs, font runs and visible characters. False when there is no such text layer.
pub(crate) fn replace_text(scene: &mut Scene, layer: &str, text: &str) -> bool;
```

- [ ] **Step 1: Write the failing tests** — `replace_text_reaches_a_layer_inside_a_group_and_a_mask`; `replace_text_clears_the_runs_that_index_the_old_text` (a layer with `color_runs`, `font_runs` and `visible_characters` and a longer text: all three are cleared, the other style fields kept); `replace_text_refuses_a_missing_or_non_text_layer`; `a_reused_request_without_a_held_scene_evaluates` (the worker's choice as a pure fn `scene_source(request, held: bool) -> SceneSource { Held, Evaluate }`).
- [ ] **Step 2: Run them, expect FAIL** — `cargo test -p celesta-editor replace_text scene_source`
- [ ] **Step 3: Implement** — the worker loop keeps the last evaluated `Scene`; a request renders a clone with the override applied, then returns the overridden layer's `text_layout` with the frame. `refresh_preview` copies the view's active override into every request (so `take_latest` can't drop it) and sets `reuse_scene` only for a keystroke's request (Task 4 calls it).
- [ ] **Step 4: Run them, expect PASS**; then `cargo test -p celesta-editor`.
- [ ] **Step 5: Commit** — `feat(editor): re-render the held scene with a layer's text replaced`

### Task 3: The edit model and its geometry

Runs in parallel with Task 2 (a new module; it reads only Task 1's `TextLayout` and `LayerFrame`).

**Files:**
- Create: `crates/editor/src/inline_text.rs` (with `#[cfg(test)] mod tests`)
- Modify: `crates/editor/src/main.rs` (`mod inline_text;`)

**Interfaces:**
- Consumes: `TextLayout` and `LayerFrame.first_baseline` (Task 1; tests build layouts by hand), `canvas_geometry::{layer_map, apply}`, `layer_select::letterbox`.
- Produces:

```rust
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TextEdit { /* text, anchor, head, upstream, marked: Option<(Range<usize>, String)> */ }
impl TextEdit {
    pub(crate) fn new(text: String) -> Self;            // caret at the end
    pub(crate) fn text(&self) -> &str;                  // committed text, without marked text
    pub(crate) fn display_text(&self) -> String;        // with marked text, what is rendered
    pub(crate) fn selection(&self) -> Range<usize>;     // code points, ordered
    pub(crate) fn insert(&mut self, text: &str);        // replaces the selection; normalizes \r\n, \r
    pub(crate) fn backspace(&mut self); pub(crate) fn delete(&mut self);
    pub(crate) fn move_horizontal(&mut self, forward: bool, extend: bool);
    pub(crate) fn move_vertical(&mut self, layout: &TextLayout, down: bool, extend: bool);
    pub(crate) fn move_line_edge(&mut self, layout: &TextLayout, end: bool, extend: bool);
    pub(crate) fn select_all(&mut self); pub(crate) fn selected_text(&self) -> String;
    pub(crate) fn place(&mut self, index: usize, upstream: bool, extend: bool);
    // GPUI input handler support (UTF-16 ranges over display_text):
    pub(crate) fn replace_utf16(&mut self, range: Option<Range<usize>>, text: &str);
    pub(crate) fn mark_utf16(&mut self, range: Option<Range<usize>>, text: &str, selected: Option<Range<usize>>);
    pub(crate) fn unmark(&mut self);
    pub(crate) fn marked_utf16(&self) -> Option<Range<usize>>; pub(crate) fn selection_utf16(&self) -> Range<usize>;
}
/// The layout box's top-left in the layer's own pixels: the first baseline's left end, up by the ascent.
pub(crate) fn layout_origin(frame: &LayerFrame, layout: &TextLayout) -> Option<Point>;
/// The caret at `index` as a segment (line top, line bottom) in own pixels.
pub(crate) fn caret(layout: &TextLayout, origin: Point, index: usize, upstream: bool) -> [Point; 2];
/// One quad per line the range covers, in own pixels.
pub(crate) fn selection_quads(layout: &TextLayout, origin: Point, range: Range<usize>) -> Vec<[Point; 4]>;
/// The caret position nearest to an own-pixel point: (index, upstream).
pub(crate) fn index_at(layout: &TextLayout, origin: Point, point: Point) -> (usize, bool);
/// Own pixels to scene pixels and back, through the frame's maps (None when a map collapses).
pub(crate) fn to_scene(frame: &LayerFrame, own: Point) -> Point;
pub(crate) fn to_own(frame: &LayerFrame, scene: Point) -> Option<Point>;
```

- [ ] **Step 1: Write the failing tests** — edit model: `insert_replaces_the_selection`, `backspace_removes_one_grapheme` ("e\u{301}" goes at once), `shift_moves_extend_the_selection`, `paste_normalizes_line_breaks`, `marked_text_shows_in_display_text_and_unmark_keeps_text_unchanged`, `utf16_ranges_round_trip_through_astral_and_japanese_text` ("日本🎌語"), `escape_after_marking_restores` (a fresh `TextEdit::new(original)` equals the start). Geometry, with hand-built layouts: `caret_on_a_wrapped_line_start_and_upstream_end`, `caret_in_a_multi_line_text_steps_by_line_height`, `caret_before_an_rtl_cluster_is_at_its_right_edge`, `caret_inside_a_ligature_interpolates`, `an_empty_line_s_caret_follows_alignment`, `selection_over_two_lines_gives_two_quads`, `index_at_round_trips_caret` (every boundary of a wrapped two-line text), `vertical_moves_keep_x`, `home_and_end_use_visual_lines`, `geometry_follows_a_rotated_scaled_layer` (`to_scene(caret)` against hand-computed points for rotation 30°, scale 2, anchor (0.5, 0.5)), `single_line_origin_is_the_line_box` (frame with an ink-trimmed anchor box and a `first_baseline`: origin y = baseline − ascent).
- [ ] **Step 2: Run them, expect FAIL** — `cargo test -p celesta-editor inline_text`
- [ ] **Step 3: Implement.** Line `i` spans `line_starts[i]..line_starts[i + 1]` (the last to the text's end); its top is `origin.y + i · line_height`. A caret x on line `i` is the left edge of the cluster whose `start` is the index (its right edge for `rtl`), else the right edge of the cluster that ends there, else, inside a cluster, `x + width · (index − start) / (end − start)`.
- [ ] **Step 4: Run them, expect PASS**; then `cargo test -p celesta-editor`.
- [ ] **Step 5: Commit** — `feat(editor): model an inline text edit and its caret geometry`

### Task 4: Editing on the canvas

**Files:**
- Modify: `crates/editor/src/{view.rs,viewer.rs,transform_drag.rs,main.rs}`; create `crates/editor/src/inline_text_view.rs` for the view glue if `viewer.rs` would grow past ~1800 lines
- Test: the modules' `#[cfg(test)]` blocks

**Interfaces:**
- Consumes: Tasks 2 and 3.
- Produces:

```rust
pub(crate) struct InlineTextSession { pub(crate) layer: String, pub(crate) edit: TextEdit, pub(crate) original: String, pub(crate) layout: Option<TextLayout> }
// EditorView gains: inline_text: Option<InlineTextSession>, inline_text_focus: FocusHandle,
// inline_note: Option<(String /* layer */, String /* reason */)>
/// Whether a double-click on `layer` starts an edit, and with which text; else the reason.
pub(crate) fn inline_entry(targets: Option<(&ElementTargets, &LayerSourceReport)>, unavailable: Option<&str>, primitive: Option<&str>, flat: bool) -> Result<String, String>;
impl EditorView {
    pub(crate) fn begin_inline_text(&mut self, layer: String, window: &mut Window, cx: &mut Context<Self>);
    pub(crate) fn inline_text_changed(&mut self, cx: &mut Context<Self>); // live request, reuse_scene
}
impl EntityInputHandler for EditorView { /* over the session's TextEdit */ }
```

- [ ] **Step 1: Write the failing tests** — `inline_entry_takes_the_received_children` (literal, const, pass-through); `inline_entry_refuses_a_locked_row_with_its_reason` (`<Span>` children, an expression); `inline_entry_refuses_while_the_source_is_read`; `inline_entry_refuses_a_text_without_a_flat_box` ("No flat box to edit on"); `drag_state_hides_handles_and_cross_while_editing`; `a_press_in_the_layout_box_places_the_caret` (pure: screen point → `index_at` via `to_own` and `letterbox`).
- [ ] **Step 2: Run them, expect FAIL**.
- [ ] **Step 3: Implement.**
  - `select_layer_at`: `click_count >= 2` on the selected `Text` → `inline_entry`; `Ok` begins (focuses `inline_text_focus`), `Err` sets `inline_note`; checked before `begin_transform_drag`. The note clears on the next press and on selection change.
  - While editing, the canvas area tracks `inline_text_focus` with key context `"Input CanvasText"` and handles gpui-kit's Input actions (`Backspace`, `Delete`, `Enter`, `MoveLeft`/`Right`/`Up`/`Down`, `MoveHome`/`End`, `SelectAll`, `Copy`, `Cut`, `Paste`, `Undo`/`Redo` swallowed), `capture_key_down` for Shift+arrows; each change calls `inline_text_changed`.
  - The canvas paint closure calls `window.handle_input(&inline_text_focus, ElementInputHandler::new(bounds, entity), cx)` and paints caret, selection and marked underline from `session.layout` only when `layout.text == edit.display_text()`; `bounds_for_range` gives the candidate window the caret's screen box; call `window.invalidate_character_coordinates()` when the layout changes.
  - A press inside the layout box places the caret (Shift extends) and the root's `drag_move` extends the selection; `drag_state()` gives no handles or cross while editing; the outline stays.
  - The Properties `Text` row is disabled with "Editing on the canvas" while a session runs; scrubs and canvas drags don't start.
- [ ] **Step 4: Run them, expect PASS**; then `cargo test -p celesta-editor`.
- [ ] **Step 5: Commit** — `feat(editor): edit a text layer in place on the canvas`

### Task 5: Commit, cancel, and what ends an edit

**Files:**
- Modify: `crates/editor/src/{viewer.rs or inline_text_view.rs,element_rows.rs,playback.rs,refresh.rs,render.rs}`
- Test: `crates/editor/src/tests/inline_text.rs` (new, declared in `tests.rs`), using the existing `single_row`/`other_prop_report`/`resolve_in` helpers

**Interfaces:**
- Consumes: Task 4; `commit_element_row` (made `pub(crate)`), `settle_row_requests`, `SelectionGate`.
- Produces:

```rust
impl EditorView {
    /// Ends the edit, writing its text through the `text` row unless unchanged or empty.
    pub(crate) fn commit_inline_text(&mut self, cx: &mut Context<Self>);
    /// Ends the edit without writing; `reason` goes to the viewer's notice.
    pub(crate) fn cancel_inline_text(&mut self, reason: Option<&str>, cx: &mut Context<Self>);
}
/// What a committed edit writes: None when unchanged or empty.
pub(crate) fn inline_commit_value(original: &str, edited: &str) -> Option<EditValue>;
```

- [ ] **Step 1: Write the failing tests** — `inline_commit_value_skips_unchanged_and_empty`; `a_committed_edit_writes_one_history_entry` (literal JSXText; a `\n` writes `{"a\nb"}`); `a_pass_through_edit_writes_the_call_site_and_undoes_in_one_step`; `a_const_edit_writes_the_const`; `escape_drops_the_override_and_writes_nothing`; `seeking_or_playing_commits_first` (`submit_requested` → the session is committed in `settle_row_requests`); `selecting_another_layer_commits_before_the_gate`; `an_outside_change_cancels_with_the_source_changed_message`; `the_override_stays_until_the_reload_frame` (cleared in `apply_react_reload` for the write's sequence, dropped on a failed commit).
- [ ] **Step 2: Run them, expect FAIL** — `cargo test -p celesta-editor inline_text`
- [ ] **Step 3: Implement.** Enter/Cmd+Enter, blur of `inline_text_focus` (`window.on_blur`), a canvas press outside the layout box (then handled as usual), `select_layer`/`release_selection`/`toggle_interactive` (before their gate), and `settle_row_requests` (seek, playback) call `commit_inline_text`; Escape calls `cancel_inline_text(None)`; `reload_composition`'s outside-change branch calls `cancel_inline_text(Some("The source changed while editing"))` before clearing the selection. After a commit, focus returns to the root (`focus_handle`), so Cmd+Z undoes it.
- [ ] **Step 4: Run them, expect PASS**; then `cargo test -p celesta-editor`, clippy, fmt.
- [ ] **Step 5: Commit** — `feat(editor): commit or cancel an inline text edit`

### Task 6: Docs and handoff

**Files:**
- Modify: `packages/website/content/{en,ja}/docs/01-(getting-started)/03-preview.md` (an "Edit text on the canvas" section: double-click, Enter / Shift+Enter / Escape, what commits, IME, what is not editable and why, frames sized to the text following on commit)
- Modify: `docs/superpowers/specs/2026-10-23-editor-property-editing-design.md` ("Inline text editing": the rulings above that settle what the spec left open)
- Create: `docs/handoff/2026-10-25-inline-text.md` (decisions, known gaps: no undo inside an edit, no word moves, no 3D text, runs cleared while typing; "Verify by hand": the spec's manual list including Japanese input through the IME, a rotated text, a wrapped `maxWidth` text, a pass-through label, Escape after composing)

- [ ] **Step 1: Write the docs**; `pnpm --filter @celesta/website check`.
- [ ] **Step 2: Commit** — `docs(editor): describe inline text editing`

## Order

Task 1 → (Task 2 ∥ Task 3, Task 3 in a subagent worktree) → Task 4 → Task 5 → Task 6.
