import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';

/** Any unknown URL (PROJECT-PLAN P15). */
@Component({
  selector: 'ss-not-found-page',
  imports: [MatButton, RouterLink],
  template: `
    <h1>Page not found</h1>
    <p>The address may be mistyped, or the page may have moved.</p>
    <div class="actions">
      <a matButton="filled" routerLink="/">Home</a>
      <a matButton="outlined" routerLink="/lists">Lists</a>
    </div>
  `,
  styles: `
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
  `,
})
export class NotFoundPage {}
