import { Component } from '@angular/core';

/** "Simply" + the accent "Sub" pill. Text, not an image, so it follows the theme tokens. */
@Component({
  selector: 'ss-logo',
  template: `Simply <span class="pill">Sub</span>`,
  styles: `
    :host {
      white-space: nowrap;
    }

    .pill {
      padding: 0 0.3em 0.05em;
      border-radius: 999px;
      background-color: var(--ss-accent);
      color: var(--ss-on-accent);
    }
  `,
})
export class Logo {}
