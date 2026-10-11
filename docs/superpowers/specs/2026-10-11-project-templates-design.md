# Project templates design (sub-project 1)

## Goal

Starting a video today means writing `film.tsx` from scratch: `--init`
creates a five-second "Hello, Celesta" starter and nothing else. Celesta
should ship ready-made template projects that a person initializes, then
turns into their own video by replacing media and wording — without
editing the composition source.

The pieces for "change values without editing source" already exist:
`defineProjectProperties()`, `--props-file`/`--props`, value validation,
and `examples/ranking`, which is a template in all but name. What is
missing is a set of templates, a way to pick one at initialization, and a
way for a project's values to reach the preview without command-line
options.

This is sub-project 1 of 2. Sub-project 2 makes the Inspector's
"Project properties" editable, writing back to the `props.json` this
design introduces; it gets its own spec.

## Editing surfaces

A template has two layers of things to change:

1. **Values that change per video** — wording, colors, media paths, the
   aspect ratio, data files. Declared with `defineProjectProperties()` and
   set in the project's `props.json`. List-shaped content (slides, ranking
   rows, dialogue lines) lives in a data file that a `path` property names,
   as `examples/ranking` does today.
2. **Structural tuning** — durations, transition length, margins, type
   sizes, motion amounts. A clearly marked constants block at the top of
   `film.tsx`, for people who are comfortable editing code.

## Templates

| Name | Title | Contents |
| --- | --- | --- |
| `blank` | Blank | Today's starter, unchanged, with no `props.json`. The default. |
| `slideshow` | 写真スライドショー | A title card, then photos with captions joined by transitions, with optional music. |
| `ranking` | ランキング | `examples/ranking`, moved and extended with `format`. |
| `dialogue` | キャラクター会話 | Two characters talking, with subtitles, lip sync, and voices. |

### Common rules

- `film.tsx` is laid out as: a header comment saying what to replace and
  where, the constants block, then `defineProjectProperties()`.
- Every template except `blank` declares
  `format: { type: 'select', options: ['16:9', '9:16'] }`, rendering at
  1920×1080 or 1080×1920, 30 fps. Layouts derive their size from `format`
  and stack vertically in 9:16.
- Duration follows the data: `prepare()` reads the data file through
  `getProjectProperty()` and the length comes from the slide count, row
  count, or voice lengths.
- Text uses Noto Sans JP from Google Fonts, loaded with `<Font>`; the
  first preview or export downloads it, later ones use the cache.
- Code comments are in English, matching the repository. Sample wording is
  Japanese.

### `blank`

`crates/react-bridge/templates/film.tsx` moves to `templates/blank/film.tsx`
unchanged. It has no `props.json`, so `--init` without `--template` produces
the same project as today.

### `slideshow`

Properties:

| Key | Type | Default |
| --- | --- | --- |
| `title` | string | sample title |
| `subtitle` | string | sample subtitle |
| `format` | select `16:9` / `9:16` | `16:9` |
| `accent` | color | sample accent |
| `transition` | select `crossfade` / `slide` / `wipe` | `crossfade` |
| `secondsPerSlide` | number | `4` |
| `slides` | path | `./slides.json` |
| `music` | path | `./assets/music.wav`; `""` for none |

`slides.json` is an array of `{ "image": string, "caption"?: string }`.
Image paths resolve from the folder holding `slides.json`. `prepare()`
rejects an empty array or an entry without `image`.

The film is a title card followed by one `<Image fit="cover">` per slide,
with a slow pan and zoom and the caption along the bottom, joined with
`<TransitionSeries>` using the chosen transition. Music fades out over
the last second.

Sample media: five placeholder photos drawn with Celesta and a short music
loop synthesized by a script. The scripts live in
`templates/slideshow/source/`, are not copied into projects, and the media
they produce is licensed like the repository.

### `ranking`

`examples/ranking` moves to `templates/ranking`. It gains the `format`
property and a `props.json` holding the values its declarations default
to today. `variants/spring.json` and `variants/autumn.json` stay as the
example of rendering several videos with `--props-file`. Documentation that
points at `examples/ranking` is updated to `templates/ranking`, and
`examples/ranking` is removed rather than kept as a duplicate.

Properties: `title`, `subtitle`, `accent`, `theme` (`dark` / `light`),
`format`, and `data` (path, `./data.json`).

### `dialogue`

Properties:

| Key | Type | Default |
| --- | --- | --- |
| `title` | string | sample title |
| `format` | select `16:9` / `9:16` | `16:9` |
| `script` | path | `./script.json` |
| `background` | path | `""` (solid color) |
| `backgroundColor` | color | sample color |
| `music` | path | `""` (none) |

`script.json` carries the cast as well as the lines, so a different cast
needs no code:

```json
{
  "characters": {
    "shizuku": {
      "name": "しずく",
      "color": "#3f8fd6",
      "portraits": { "normal": "assets/shizuku-normal.png", "smile": "assets/shizuku-smile.png" },
      "mouths": {
        "closed": "assets/mouth-closed.png",
        "a": "assets/mouth-a.png", "i": "assets/mouth-i.png", "u": "assets/mouth-u.png",
        "e": "assets/mouth-e.png", "o": "assets/mouth-o.png"
      }
    }
  },
  "lines": [
    { "speaker": "shizuku", "text": "こんにちは。", "reading": "こんにちわ", "expression": "smile", "voice": "assets/voices/001.wav" }
  ]
}
```

`mouths` lists `closed` and the vowels `a`, `i`, `u`, `e`, `o`. Paths
resolve from the folder holding `script.json`. `prepare()` rejects a line
whose `speaker` is not in `characters` or whose `expression` has no
portrait. `voice` is optional: `planDialogue()` times a line with a voice
from its recording, and a line without one from the length of its text,
with the mouth moving through the vowels of its reading. `<DialogueSeries>`
plays the lines with subtitle bands, lip sync, and the speaker's name. In 9:16 the portraits sit at the bottom and the subtitle
band above them.

Sample media: the portraits from `examples/assets/dialogue-demo`, copied
into the template. The sample lines have no voices; the template's README
explains how to add recordings.

### Template README

Each template has a `README.md`: what to replace, a table of its
properties, how to render variants with `--props-file`, and the license of
its sample media.

## Template source and distribution

Templates live at the repository root:

```
templates/
  package.json        # @celesta/templates (private): type checks and tests
  tsconfig.json
  test/
  slideshow/
    template.json     # metadata, not copied
    film.tsx
    props.json
    slides.json
    assets/
    source/           # media generation scripts, not copied
    README.md
```

`template.json`:

```json
{
  "title": "写真スライドショー",
  "description": "写真とキャプションを並べ、トランジションでつなぐスライドショー。",
  "edit": "Edit props.json and slides.json, and replace the files in assets/."
}
```

`title` and `description` are shown in the GUI and by `--list-templates`.
`edit` is printed after initialization. Template folders hold no
`package.json`; initialization writes the shared `package.json`,
`tsconfig.json`, and `.gitignore` as it does today. `templates/` is added
to `pnpm-workspace.yaml` so its `package.json` resolves the Celesta packages
for type checking.

A new `packages/cli/scripts/stage-templates.mjs` runs in `@celesta/cli`'s
`build`, after `stage-project-types.mjs`, and copies each
`templates/<name>/` into `packages/cli/dist/templates/<name>/`, leaving out
`source/`. `stage-react-runtime.mjs` already copies all of `dist/`, so the
desktop packages ship the templates with no packaging change, and a
template always matches the runtime it runs on.

On the Rust side, `project_templates_dir(cli_script)` returns
`<dir of cli.js>/templates`, mirroring `project_types_template`.

## Initialization

### Command line

```
celesta-editor --init [DIRECTORY] [--template NAME]
celesta-editor --list-templates
```

- `--template` requires `--init`. Without it, `blank` is used.
- `--list-templates` prints one line per template — name, title,
  description — and exits. It conflicts with `PROJECT`, `--init`, and the
  property options.
- An unknown name fails before anything is written, with exit status 1
  and the available names in the message. Names are checked at
  initialization, not by clap, because the list comes from the runtime.
- After initializing, the editor prints the existing message followed by
  the template's `edit` line.

### Existing files

- **Without `--template`:** unchanged behaviour. `.celesta/` is refreshed
  and missing starter files are created from `blank`; existing files are
  kept.
- **With `--template`:** if any file the template would create already
  exists in the destination (`film.tsx`, `props.json`, data files, files
  under `assets/`, `README.md`, `variants/`…), nothing is written and the
  error lists every conflicting path. This prevents a mix such as the
  blank `film.tsx` beside the slideshow's `props.json`, which would fail
  validation.
- In both cases `package.json`, `tsconfig.json`, and `.gitignore` are kept
  when they exist.

### GUI

**File › Create New Project…** shows a template chooser before the folder
picker. The chooser is a gpui-kit dialog listing each template's title and
description; `blank` is selected initially, Enter confirms, and Escape
cancels. Then the folder picker, initialization, and opening `film.tsx`
proceed as today. A conflict or a missing template is shown in the
existing `open_error` as `Couldn’t create project: …`.

### Code layout

- New module `crates/react-bridge/src/project_templates.rs`: list
  templates from a templates directory (skipping folders with a missing or
  invalid `template.json`), check for conflicts, and copy a template
  (recursively, without `template.json`).
- `initialize_project` takes the runtime's `cli.js` path and an optional
  template name, and uses the module above for the starter files. The
  `include_str!` starter is removed.
- `project_types.rs` keeps only `.celesta/` management.

## `props.json` next to the entry

### Rule

When an entry is opened or exported without `--props-file`, and
`props.json` exists in the entry's own folder (not an ancestor), it is
loaded as a property layer with the new source `entryProps`. An explicit
`--props-file` replaces it rather than stacking on it. `--props` still wins
over either. Relative paths in it resolve from its folder, as for
`--props-file`.

Precedence, highest first:

1. `--props`
2. `--props-file`, or else the entry's `props.json`
3. the `--project` companion file's `properties`
4. the nearest `<ProjectProvider>` (only `useProjectProperty`)
5. the declared `defaultValue`
6. the hook's or function's `defaultValue` argument

### Strictness

- When the entry declares properties, `entryProps` is checked exactly like
  `--props-file`: undeclared keys, types, color format, and path existence
  are errors reported through `invalidProperties`.
- When the entry declares none, the layer is ignored with a warning,
  so an unrelated file that happens to be called `props.json` does not
  break a project. The repository has no such file today.
- A `props.json` that is not valid JSON, or not an object, is an error
  even when the entry declares nothing.

The schema is known only after the entry's module scope runs, so the check
lives in `packages/react/src/property-inputs.ts` with the other sources.

### Plumbing

- `PropertyInputs::load_for_entry(entry, props_file, props)` performs the
  discovery. The editor, the exporter, and `skills/celesta/scripts/inspect.mjs`
  (with the same rule in JavaScript) all go through it.
- **Editor:** discovery runs on every reload. The reload watcher adds the
  existence and mtime of `<entry dir>/props.json`, so creating, editing, or
  deleting it reloads. Opening another entry with File › Open discovers that
  entry's `props.json`; explicit options are still dropped as today. The
  React Preview panel lists the source as `props.json (auto)`.
- **Exporter:** the dashboard's export settings show
  `Props: props.json (auto)`. The `--json` result gains `propsFile` (the
  file's path) and `propsFileAuto` (boolean) whenever a props file was used.
  Validation failures keep the code `invalid_properties`, with `source`
  `entryProps`.

## Errors

- The runtime has no `templates/` folder or no such template: "Template
  files are missing from the Celesta runtime (…)" or "Unknown template
  `x`; available: …". Nothing is created in the destination.
- A conflict with existing files lists every conflicting path. Nothing is
  written.
- A template folder without a valid `template.json` is not listed and
  cannot be chosen.

## Testing

Rust (`cargo test --workspace`):

- `project_templates`: listing reads `template.json` and skips invalid
  folders; copying is recursive and leaves out `template.json`; a single
  conflict writes nothing and reports every conflict; an unknown name
  lists the available ones; the existing `initialize_creates_a_project…`
  test still passes without `--template`.
- `PropertyInputs::load_for_entry`: discovers `props.json`, is replaced by
  `--props-file`, is overridden by `--props`, and adds no layer when the
  file is absent.
- CLI parsing: `--template` requires `--init`; `--list-templates` conflicts
  with the other modes.
- Exporter `--json` includes `propsFile` and `propsFileAuto`.

Node:

- `property-inputs.ts`: `entryProps` is strict with a schema, and ignored
  with a warning without one; malformed JSON is always an error.
- `@celesta/templates` tests evaluate every template with its own
  `props.json` in both `16:9` and `9:16`: module load, property validation,
  `prepare()`, and the composition's size, fps, and duration. Rendering
  happens in Rust, so no font download is needed and the tests run offline
  in CI as part of `pnpm run test:runtime`.
- The same tests check that `stage-templates.mjs` produced
  `dist/templates/<name>/template.json` and left out `source/`.

Manual, recorded in the handoff note:

- For each template and both formats, `--init --template` into a scratch
  folder, then export `--every 30 --contact-sheet` and inspect the sheet.
- In the GUI: chooser → folder → preview → edit `props.json` and see the
  preview reload.

## Documentation

- README: "Create a React project" (templates, `--list-templates`,
  `props.json`) and "Render variants of one composition" (paths move to
  `templates/ranking`).
- `skills/celesta/references/setup.md`: `--list-templates` and
  `--template`.
- `skills/celesta/references/project-data.md`: automatic `props.json`.
- `skills/celesta/SKILL.md`: a "start from a template" row in the task
  table.
- `docs/handoff/2026-10-11-project-templates.md`.

## Out of scope

- Editing properties in the Inspector (sub-project 2).
- Templates from outside the runtime: user template folders, downloading
  templates, or `--template <path>`.
- Bundling fonts with templates.
- An array or object property type; list-shaped content stays in data files.
