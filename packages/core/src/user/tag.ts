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

/**
 * The colours a new tag can take (P6's inline create; P13 adds a hex field). They're stored values, not theme
 * colours: a tag chip shows its colour as a dot beside the name, so the name's contrast never depends on it. Each has
 * a name for screen readers.
 */
export const tagColorPresets: readonly { name: string; color: string }[] = [
  { name: 'Red', color: '#e53935' },
  { name: 'Orange', color: '#fb8c00' },
  { name: 'Yellow', color: '#fdd835' },
  { name: 'Lime', color: '#7cb342' },
  { name: 'Green', color: '#2e7d32' },
  { name: 'Teal', color: '#00897b' },
  { name: 'Cyan', color: '#00acc1' },
  { name: 'Blue', color: '#1e88e5' },
  { name: 'Indigo', color: '#3949ab' },
  { name: 'Purple', color: '#8e24aa' },
  { name: 'Pink', color: '#d81b60' },
  { name: 'Grey', color: '#757575' },
];
