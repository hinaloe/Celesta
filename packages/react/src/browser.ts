// Browser entry for the same React host and scene evaluator used by the CLI.
// File-system helpers and project loading are deliberately outside this entry.
import * as React from 'react';

export { React };
export { mount } from './render';
export type { MountedComposition, EntryComponent } from './render';
export {
  Audio, Assets, Character, CharacterView, Composition, Dialogue, Font,
  Group, Image, Rect, Sequence, Text, Video,
} from './components';
export { useCurrentFrame, useCurrentTime, useIsPreview, useVideoConfig } from './hooks';
export { Easings, interpolate, spring } from './animation';
export { Transition } from './transition';
export { Center, Fit, Grid, SafeArea, Stack, useLayoutBounds } from './layout';
export { DebugBounds, DebugOverlay } from './debug';
export { registerComponent, getComponentSchema } from './registry';
export { defineProjectProperties, listProjectProperties } from './properties';
export { mediaDurationInFrames } from './media';
