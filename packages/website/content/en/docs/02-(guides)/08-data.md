## Load data before rendering

Each frame is rendered synchronously, so a component cannot wait for a file or a network request. Do that work in an `async prepare()` export instead. It runs once, before the first frame, in both the preview and exports. Store the results in module-level variables, then read them while rendering:

```tsx title="Fetch once, use on every frame"
let headlines: string[] = ['Hello from Celesta'];

export async function prepare() {
  try {
    const response = await fetch('https://example.com/headlines.json');
    headlines = (await response.json()) as string[];
  } catch (error) {
    console.error('Using the fallback headline', error);
  }
}
```

Keep a fallback value so the scene still renders offline. `loadLipSync()`, `loadPsdPreset()`, and `preloadMedia()` belong in `prepare()` for the same reason.

## Reuse components with data and props

Keep settings in ordinary objects or imported JSON data and pass them to React components as props. A data JSON file is not a .celesta.json timeline project. Type the props so your editor checks each use.

```tsx file=examples/data.tsx title="data.tsx"
```

> [!NOTE]
> **Existing JSON project integrations**
> ProjectProvider, useProjectProperty(), defineProjectProperties(), and registerComponent() still support existing JSON project integrations. They are not required for new React compositions; see [the legacy timeline guide](/en/docs/timelines/) when maintaining those files.
