import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Settings } from '@simply-sub/core';
import { SettingsStore } from '../settings/settings-store';
import { ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    // Before the first run: no saved settings. The real store's load could land after the click and put the saved
    // theme back, as it should in the app, which made this test flaky.
    TestBed.configureTestingModule({
      providers: [
        { provide: SettingsStore, useValue: { saved: signal<Settings | undefined>(undefined) } },
      ],
    });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('switches between light and dark and shows the current theme', async () => {
    const fixture = TestBed.createComponent(ThemeToggle);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;

    expect(button.getAttribute('aria-label')).toBe('Dark theme');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.textContent).toContain('light_mode');

    button.click();
    await fixture.whenStable();

    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.textContent).toContain('dark_mode');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
