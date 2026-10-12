import { defineStaticPageMetadata } from '@natsuneko-laboratory/makit/metadata';
import { copy } from '../site/copy/index.ts';

export default defineStaticPageMetadata({
  title: { en: copy('en').home.metadata.title, ja: copy('ja').home.metadata.title },
  description: { en: copy('en').home.metadata.description, ja: copy('ja').home.metadata.description },
  search: false,
});
