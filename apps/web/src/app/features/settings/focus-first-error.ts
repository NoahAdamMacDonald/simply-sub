import type { FieldTree } from '@angular/forms/signals';

/** A form's onInvalid: puts focus on the first field with an error, whose message the form field then shows. */
export function focusFirstError(form: FieldTree<unknown>): void {
  form().errorSummary()[0]?.fieldTree().focusBoundControl();
}
