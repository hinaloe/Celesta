The installed app already includes the React runtime. [Create a project](/en/docs/create-project/) from the app or CLI to get a starter `film.tsx` and TypeScript configuration. The starter previews and exports without a package installation or build step. Install any additional npm dependencies in your project folder.

## Make your first scene

Create `first-scene.tsx` in your own project folder. This example creates a 1920 × 1080 composition at 30 fps. The title fades in over 30 frames, then holds until the five-second composition ends.

```tsx file=examples/first-scene.tsx title="first-scene.tsx"
```

In Celesta, choose **File → Open…** and select `first-scene.tsx`. Press `Space` to play.

Change the text or colors and save. The native preview reloads the composition. Celesta components describe video layers: use `Text`, `Rect`, and `Group` rather than HTML elements or CSS classes.

## How a composition is put together

- The file’s **default export** returns a single `<Composition>` with its size, frame rate, and length.
- Everything inside it is drawn in order: later layers appear on top of earlier ones.
- Your own components are ordinary React function components. Use props, `.map()`, and conditionals as you would anywhere else.
- An optional named export, `prepare()`, runs once before the first frame. See [Data, properties & components](/en/docs/data/).

## Set up TypeScript in your editor

With a React composition open, choose **File → Set Up TypeScript**. Celesta copies matching declarations for every `@celesta/*` package, React, and Node.js into a local `.celesta/` directory.

Starting a new project with no composition yet? Choose **File → Set Up TypeScript in Folder…** and pick the project folder, so your first component is written with types in place.

If there is no `tsconfig.json`, Celesta creates one. If you already have a configuration, add this `extends` property while preserving your other settings:

```json title="tsconfig.json"
{
  "extends": "./.celesta/tsconfig.json"
}
```

You do not need to install those declaration packages from npm for this editor setup. Celesta refreshes `.celesta/` when you open the project in a newer app version; that directory ignores itself in Git.
