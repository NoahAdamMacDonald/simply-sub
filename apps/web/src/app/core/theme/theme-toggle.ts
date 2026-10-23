import { Component, computed, inject } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { ThemeService } from './theme-service';

/** The ☀/☾ button. The icon shows the current theme; "System" is chosen in Settings. */
@Component({
  selector: 'ss-theme-toggle',
  imports: [MatIconButton, MatIcon],
  templateUrl: './theme-toggle.html',
})
export class ThemeToggle {
  private readonly themeService = inject(ThemeService);

  protected readonly isDark = computed(() => this.themeService.theme() === 'dark');

  protected toggle(): void {
    this.themeService.toggle();
  }
}
