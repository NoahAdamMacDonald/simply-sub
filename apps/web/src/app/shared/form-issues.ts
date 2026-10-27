import type { ReadonlyFieldTree, ValidationError } from '@angular/forms/signals';
import type { FormIssue } from '@simply-sub/core';

/**
 * Core's form issues (FormIssue, as itemFormIssues and customSubFormIssues give them) as Signal Forms errors for a
 * validateTree, each at the field it names: ['windows', 0, 'end'] is form.windows[0].end.
 */
export function issueErrors(
  root: ReadonlyFieldTree<unknown>,
  issues: readonly FormIssue[],
): ValidationError.WithFieldTree[] {
  return issues.map(({ path, message }) => ({
    kind: 'form-issue',
    message,
    fieldTree: fieldAt(root, path),
  }));
}

function fieldAt(
  root: ReadonlyFieldTree<unknown>,
  path: readonly (string | number)[],
): ReadonlyFieldTree<unknown> {
  let field: unknown = root;
  for (const key of path) field = (field as Record<string | number, unknown>)[key];
  return field as ReadonlyFieldTree<unknown>;
}
