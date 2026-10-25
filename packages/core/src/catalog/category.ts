import * as z from 'zod';
import { iconNameSchema, slugSchema, textSchema } from './formats';

// data/categories.yaml: what a provider is (service), how the Features page groups features (feature) and the
// card-reward category of a purchase (spend).

export const categorySchema = z.strictObject({
  id: slugSchema.describe('Stable category id'),
  name: textSchema.describe('Display name'),
});
export type Category = z.infer<typeof categorySchema>;

export const serviceCategorySchema = categorySchema.extend({
  icon: iconNameSchema.describe('The Material Symbols icon shown with the category'),
});
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

export const categoriesFileSchema = z
  .strictObject({
    service: z
      .array(serviceCategorySchema)
      .min(1, 'List at least one category')
      .describe('What a provider is, set by its category field'),
    feature: z
      .array(categorySchema)
      .min(1, 'List at least one category')
      .describe("How the Features page groups features, set by a feature's category field"),
    spend: z
      .array(categorySchema)
      .min(1, 'List at least one category')
      .describe("The card-reward category of a purchase, set by a provider's spendCategory field"),
  })
  .meta({
    title: 'Simply Sub categories',
    description: 'data/categories.yaml: service, feature and spend categories',
  });
export type Categories = z.infer<typeof categoriesFileSchema>;
