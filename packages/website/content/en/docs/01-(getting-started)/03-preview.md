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
| Zoom in / out / fit the timeline | `=` / `-` / `Shift Z` | `=` / `-` / `Shift Z` |
| Clear the export range | `Shift X` | `Shift X` |
| Mark export start / end | `I` / `O` | `I` / `O` |

## Listen as you look

Playback synchronizes the picture and audio. Use waveforms and track levels to check timing, mute or solo tracks to isolate a sound, and adjust the preview volume. Drag along the timeline ruler to scrub to a specific moment.

## Preview-only guides

`<DebugOverlay />` draws the frame edge, a safe-area inset, and the center point, and `<DebugBounds>` outlines a group of layers. Both appear only in the Celesta preview and add nothing to an export, so you can leave them in while you work. `useIsPreview()` tells your own components the same thing.
