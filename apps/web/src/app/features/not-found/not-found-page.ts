import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';

/** Any unknown URL (PROJECT-PLAN P15). */
@Component({
  selector: 'ss-not-found-page',
  imports: [MatButton, RouterLink],
  templateUrl: './not-found-page.html',
  styleUrl: './not-found-page.scss',
})
export class NotFoundPage {}
