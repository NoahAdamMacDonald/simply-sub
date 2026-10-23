import { Component, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeToggle } from '../core/theme/theme-toggle';
import { Logo } from './logo';

interface NavLink {
  readonly label: string;
  readonly path: string;
}

/** The link groups in wireframe order (PROJECT-PLAN P1): Home / Lists … Calendar / Search. */
const NAV_GROUPS: readonly (readonly NavLink[])[] = [
  [{ label: 'Home', path: '/' }],
  [
    { label: 'Lists', path: '/lists' },
    { label: 'Payment', path: '/payment' },
    { label: 'Features', path: '/features' },
    { label: 'Calendar', path: '/calendar' },
  ],
  [{ label: 'Search', path: '/search' }],
];

/** Logo, page links, and the settings link and theme toggle at the bottom. */
@Component({
  selector: 'ss-sidebar',
  imports: [MatIcon, MatIconButton, RouterLink, RouterLinkActive, ThemeToggle, Logo],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class Sidebar {
  /** Emits on every link click, including one to the current page, so the drawer can close. */
  readonly navigate = output();

  protected readonly groups = NAV_GROUPS;
}
