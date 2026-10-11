# Ranking card template

One composition, several videos. `film.tsx` declares its inputs with
`defineProjectProperties()` — title, subtitle, accent color, light or dark
theme, format, and the data file — and `props.json` holds the values this
project renders with. `prepare()` reads the data file named by the `data`
property, and the composition's length follows the number of displayed rows
(up to six). 1920 × 1080 (16:9) or 1080 × 1920 (9:16), 30 fps.

Create a project from it:

```sh
celesta-editor --init my-ranking --template ranking
cd my-ranking
celesta-editor film.tsx
celesta-exporter --react film.tsx ranking.mp4
```

## What to replace

- `data.json` — the ranking, an array of `{ "name": ..., "score": ... }` rows
  with a string `name` and a number `score`. The six highest scores are
  shown, sorted; scores must be non-negative and the top score above 0. Long
  names shrink to fit their row.
- `props.json` — the title, colors, and format. Preview and export load it
  automatically.
- The theme colors, layout numbers, and motion timings are in the constants
  block at the top of `film.tsx`.

## Properties

To change these without editing JSON, open `film.tsx` in Celesta and use the preview panel's **Properties** section; it saves to `props.json`.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `title` | string | `人気ランキング` | The heading. Long titles shrink to fit one line. |
| `subtitle` | string | `サンプルデータ` | The line under the heading. Long subtitles wrap. |
| `accent` | color | `#4f8cff` | The stripe, rank numbers, and bars. |
| `theme` | `dark` / `light` | `dark` | Background, panel, and text colors. |
| `format` | `16:9` / `9:16` | `16:9` | 1920 × 1080, or 1080 × 1920 with taller rows in one column. |
| `data` | path | `./data.json` | The rows to rank. An http(s) URL is fetched instead. |

## Variants

Each file in `variants/` is another set of values. `--props-file` uses it
instead of `props.json`:

```sh
celesta-exporter --react film.tsx spring.mp4 --props-file variants/spring.json
celesta-exporter --react film.tsx autumn.mp4 --props-file variants/autumn.json
```

`--props` overrides single values without another file:

```sh
celesta-exporter --react film.tsx autumn-vertical.mp4 \
  --props-file variants/autumn.json --props '{"format":"9:16","title":"秋のおすすめドリンク"}'
```

Preview a variant with the same values (edits to the variant file reload the
preview):

```sh
celesta-editor film.tsx --props-file variants/spring.json
```

Relative paths in a variant file, such as `"data": "spring-drinks.json"`,
resolve from that file's folder.

From the repository root, the paths start with `templates/ranking/`:

```sh
cargo run -p celesta-exporter --release -- --react templates/ranking/film.tsx spring.mp4 \
  --props-file templates/ranking/variants/spring.json
```

## License

Noto Sans JP is loaded from Google Fonts (SIL Open Font License). The sample
data is made up for this template.
