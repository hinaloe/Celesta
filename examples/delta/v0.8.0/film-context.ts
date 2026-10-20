import { createContext } from 'react';
import type { ComponentType } from 'react';

// The film's own scene tree, for the parts of it that replay other frames
// with <FreezeFrame>: the open's teaser, the MCP chapter's rendered frames,
// the outro's thumbnails. Handed down through context so a chapter can draw
// the film without importing the module that lists the chapters.
export const FilmContext = createContext<ComponentType>(() => null);
