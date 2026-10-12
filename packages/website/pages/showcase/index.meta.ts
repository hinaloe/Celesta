import { defineStaticPageMetadata } from '@natsuneko-laboratory/makit/metadata';
import { copy } from '../../site/copy/index.ts';

export default defineStaticPageMetadata({
  title: { en: copy('en').showcase.label, ja: copy('ja').showcase.label },
  description: { en: copy('en').showcase.metadataDescription, ja: copy('ja').showcase.metadataDescription },
  search: false,
});
