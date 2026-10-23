import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeToggle } from './core/theme/theme-toggle';

@Component({
  selector: 'ss-root',
  imports: [RouterOutlet, ThemeToggle],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
