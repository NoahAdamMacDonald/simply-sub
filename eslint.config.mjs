// @ts-check
// One flat config for the whole monorepo. Formatting is Prettier's job, so no style rules here.
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Colours come from the tokens in _tokens.scss (BLUEPRINT §8.1). Stylelint checks stylesheets;
// these selectors catch hex values in inline component styles and template attributes.
const hexColour = String.raw`/#[0-9a-fA-F]{3,8}\b/`;
const noHexMessage = 'Use a colour token (var(--ss-…)) from _tokens.scss instead of a hex value.';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/.angular/',
    '**/coverage/',
    '**/.wrangler/',
    'apps/api/public/simply/',
    'docs/',
  ]),
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, tseslint.configs.recommended, tseslint.configs.stylistic],
  },
  {
    files: ['apps/web/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'ss', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'ss', style: 'kebab-case' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Property[key.name='styles'] :matches(Literal[value=${hexColour}], TemplateElement[value.raw=${hexColour}])`,
          message: noHexMessage,
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `TextAttribute[name!='href'][value=${hexColour}]`, message: noHexMessage },
      ],
    },
  },
);
