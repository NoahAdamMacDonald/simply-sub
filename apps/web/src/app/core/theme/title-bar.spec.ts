import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService, type Theme } from './theme-service';
import { followThemeInTitleBar } from './title-bar';

// An installed app's title bar (M10.6): index.html's theme-color metas, one per OS scheme, both take the colour of the
// theme on screen once the app has started.

describe('the title bar colour', () => {
  it('gives both theme-color metas the colour of the theme on screen, whatever the OS', () => {
    const metas = [
      ['light', '#ffffff'],
      ['dark', '#000000'],
    ].map(([scheme, colour]) => {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.media = `(prefers-color-scheme: ${scheme})`;
      meta.content = colour;
      return meta;
    });
    document.head.append(...metas);
    const theme = signal<Theme>('light');
    TestBed.configureTestingModule({ providers: [{ provide: ThemeService, useValue: { theme } }] });
    try {
      followThemeInTitleBar(TestBed.inject(Injector));
      TestBed.tick();
      expect(metas.map((meta) => meta.content)).toEqual(['#ffffff', '#ffffff']);
      theme.set('dark');
      TestBed.tick();
      expect(metas.map((meta) => meta.content)).toEqual(['#000000', '#000000']);
    } finally {
      metas.forEach((meta) => meta.remove());
    }
  });
});
