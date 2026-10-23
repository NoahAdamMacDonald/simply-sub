import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  it('renders the shell: sidebar navigation and the main landmark', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('ss-shell nav[aria-label="Main"]')).toBeTruthy();
    expect(element.querySelector('ss-shell main#main')).toBeTruthy();
  });
});
