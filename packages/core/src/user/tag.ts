import * as z from 'zod';
import { textSchema } from '../catalog/formats';
import { recordMetaShape } from './record';

/** A tag's colour, `#rrggbb`. Nothing else gets through, so it's safe to bind as a style. */
export const tagColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a hex colour, #rrggbb');

/** A coloured label for list items, managed in Settings (P13). Items point at it with `tagIds`. */
export const tagSchema = z.strictObject({
  ...recordMetaShape,
  name: textSchema,
  color: tagColorSchema,
});
export type Tag = z.infer<typeof tagSchema>;
