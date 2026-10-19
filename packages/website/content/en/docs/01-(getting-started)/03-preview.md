Choose **File → Open…** to open a React composition (`.tsx`, `.jsx`, `.ts`, or `.js`). Select an asset, track, or clip to inspect its details.

> [!NOTE]
> **Your source is your canvas**
> Edit the composition in your text editor. Celesta previews and exports it; save the source to update the preview.

Compositions reload when you save. You can also choose **File → Reload** to reload manually.

**Keyboard shortcuts**

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Create a new project | `⌘ N` | `Ctrl N` |
| Open a project | `⌘ O` | `Ctrl O` |
| Reload the composition | `⌘ R` | `Ctrl R` |
| Play / pause | `Space` | `Space` |
| Step backward / forward | `←` / `→` | `←` / `→` |
| Jump backward / forward one second | `Shift ←` / `Shift →` | `Shift ←` / `Shift →` |
| Jump to the previous / next clip edge | `↑` / `↓` | `↑` / `↓` |
| Go to the start / end | `Home` / `End` | `Home` / `End` |
| Loop playback (the marked range if set) | `⌘ /` | `Ctrl /` |
| Toggle safe areas | `'` | `'` |
| Select layers (React compositions) | `V` | `V` |
| Zoom in / out / fit the timeline | `=` / `-` / `Shift Z` | `=` / `-` / `Shift Z` |
| Clear the export range | `Shift X` | `Shift X` |
| Mark export start / end | `I` / `O` | `I` / `O` |

## Listen as you look

Playback synchronizes the picture and audio. Use waveforms and track levels to check timing, mute or solo tracks to isolate a sound, and adjust the preview volume. Drag along the timeline ruler to scrub to a specific moment, or swipe sideways over the tracks to move the playhead back and forth. Pinch over the tracks to zoom the timeline, and hold Option (Alt) while you scroll over them to pan it.

## Debug guides

`<DebugOverlay />` outlines a safe area, shades the canvas outside it, and marks the center point, and `<DebugBounds>` outlines a group of layers. They appear in the Celesta preview, and in PNG frames and contact sheets exported with `--debug-guides`, but never in a video, so you can leave them in while you work. `useDebugGuides()` tells your own components when guides are drawn.

## Find a layer's source

Turn on **Select layers** with the pointer button next to **Safe areas** below the viewer, **View → Select Layers**, or `V`. This interactive mode is available when you open a React composition. It records where each element was written and where each layer is drawn, which slows down scenes with thousands of layers, so the preview starts without it; turn it off again to play such scenes at full speed. Switching restarts the composition's runtime, which takes a moment.

In interactive mode, click a layer in the preview to select it. An orange outline marks it, and the **Properties** tab, next to **React Preview**, shows a **Layer** section with its ID and where it was written, below the values you can edit. **Source** gives the element nearest the layer, such as a `<Rect>` in `Title.tsx`, as its name and `file:line:column`. **Called from** lists the elements around it, from the nearest outward, such as the `<Title>` that renders it and the `<Sequence>` it sits in. Click any row to open that position in your text editor. Click an empty part of the canvas to clear the selection.

A layer is hit anywhere inside the box it is drawn in, including transparent pixels of an image and the gaps between glyphs. A `<Rect>` with a stroke and no fill is hit only on its stroke, so you can select what is inside an outline. Where layers overlap, the one drawn last wins. A layer that is not in the frame being shown reads **Not in this frame**. A reload after an edit made outside Celesta, or turning interactive mode off, clears the selection. Celesta's own edits from the canvas, the **Layer** section, or the props file's **Properties** section, and undo and redo, keep it.

Celesta opens the position in the editor named by the `VISUAL` environment variable, then `EDITOR`. It can include arguments, such as `code -n`. On macOS and Linux, Celesta also asks your login shell for them when the app does not have them, such as when it was started from the Dock or Finder, so variables set in your shell profile still apply. VS Code (`code`), Cursor, Windsurf, Zed, Sublime Text, JetBrains IDEs, and TextMate open at the line and column; other editors are passed `+line file`. With neither variable set, the file opens in your system's default application, without a position.

Editors that run inside a terminal, such as `vim`, `nano`, and `emacs -nw`, cannot be started from the app. Celesta shows a message instead; set `VISUAL` to a graphical editor.

## Move layers on the canvas

In interactive mode, a selected layer can be moved, rotated, and scaled, and the result is written into your source. Drag inside the outline to move it, drag a square handle at a corner or an edge to scale it about its anchor, and drag the handle above the top edge to rotate it (hold Shift to snap to 15°). You can also type a value into the **Transform** rows at the top of the **Properties** tab and press Enter or leave the field. One drag or one committed field is one change to the file: Celesta replaces only the number it changes and leaves the rest of your formatting and comments as they are, and the preview keeps the selection when it reloads.

Celesta writes a value only where your source states it plainly, on an element written directly in your file:

- A number such as `x={80}` or `rotation={-12}` is replaced.
- A prop you left out is added, such as `x={140}` on a `<Rect>` with no `x`.
- A prop written as `interpolate(frame, [0, 30, 60], [100, 600, 300])` can be edited on a frame that is one of the listed keyframes, such as 30; the matching output value is changed. The frame is the value `frame` has where the element is written, so a `<Sequence>` between the `useCurrentFrame()` call and the element does not shift it. Between keyframes the field is read-only and shows **Between keyframes at 0 and 30**, with buttons that jump to them. Celesta does not insert keyframes.
- A `const x = 80` used by one element is replaced where it is declared.

Anything else is locked: its field shows a lock icon and the reason, and the outline turns dashed when nothing on the layer can be moved. The reasons are below; a word in angle brackets, such as `<name>`, stands for the part taken from your source.

| Reason | Meaning |
| --- | --- |
| Set by a component, not written on this element | The element nearest the layer is your own component (or another library's), not a Celesta element such as `<Rect>` |
| Written as an expression: `<expression>` | A value such as `W / 2` or `i * 24` |
| Comes from `<name>`, which can't be traced | An import, a `let`, a parameter, an object property, or a name declared more than once in the component, such as again inside a block or loop |
| `<name>` is used in `<count>` places | Editing the shared `const` would move other elements too |
| Between keyframes at `<frame>` and `<frame>` | The frame is not one of the keyframes; use the buttons to jump to one |
| Outside the keyframes | The frame is before the first or after the last keyframe |
| Computed by `<function>`() | A call such as `spring()` |
| A layout component sets this value | The element received another value than the one written: a parent, such as a layout component, replaced it |
| May be set by a spread ({...props}) | The element has `{...props}` and no value of its own, or the spread comes after the value |
| Rendered `<count>` times from this element | An element in `.map()`; editing it would move every copy |
| Can't tell which frame this animation reads | `frame` could hold more than one frame (each `<Sequence>` or `<FreezeFrame>` around the element gives another), and those frames give different keyframes with the same value |
| This file is outside the project | The element is written in a file outside the entry file's folder, or inside `node_modules` |
| Couldn't find this element in the source | The file no longer has the element where the preview found it, such as while a save is still reloading |
| The source has syntax errors | Fix the file first; every field is locked until it parses |

If the file changes while you drag, Celesta discards the drag and says so instead of writing over your edit. Only `x`, `y`, `rotation`, and `scale` (or `scaleX` and `scaleY`, when written) are edited; size props such as `width`, the anchor, and skew are not.

A layer inside a `<Group>` or `<Stack>` moves with its parent. A child of a `<Stack>` stays editable: its `x` and `y` are offsets from the place the `<Stack>` gives it. Each row of **Called from** that is a Celesta element drawing its own layer, such as a `<Group>`, has a **Select** button that selects that layer; a group is outlined as the box around its children, and dragging anywhere inside it moves the whole group. A `<Stack>` or `<SafeArea>` row has no **Select** button: they are components, and the groups they create are not written in your source.

## Undo

Undo (`⌘ Z`, `Ctrl Z`) and redo (`⌘ Shift Z`, `Ctrl Shift Z`) step through the changes Celesta wrote, whether from the canvas, the **Layer** section, or the props file's **Properties** section, in one history that holds up to 100 changes and is cleared when you open another file. If the file was edited elsewhere since the change, Celesta refuses to undo it rather than overwrite your edit.
