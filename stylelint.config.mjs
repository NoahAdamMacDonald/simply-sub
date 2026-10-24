// Stylelint only guards the theme rule: colours come from the tokens in _tokens.scss, so no other
// stylesheet may contain a hex value (BLUEPRINT §8.1). Formatting is Prettier's job.
/** @type {import('stylelint').Config} */
export default {
  customSyntax: 'postcss-scss',
  ignoreFiles: ['**/dist/**', '**/.angular/**', '**/coverage/**', 'apps/api/public/**'],
  rules: {
    'color-no-hex': true,
  },
  overrides: [
    {
      files: ['**/_tokens.scss'],
      rules: { 'color-no-hex': null },
    },
  ],
};
