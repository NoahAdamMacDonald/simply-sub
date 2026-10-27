import { DOCUMENT } from '@angular/common';
import { ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';

/**
 * A card's details, which slide open and shut (M5.7): Search's cards and List view's (ss-sub-card, ss-item-card).
 * Call it in a field initializer, with the details' body (the grid row that animates) and the details button, which
 * Hide details at their foot puts focus back on. Once they've moved, the card scrolls back into view if that left
 * part of it off screen.
 */
export function slidingDetails(
  body: () => HTMLElement | undefined,
  button: () => HTMLElement | undefined,
): SlidingDetails {
  return new SlidingDetails(body, button);
}

export class SlidingDetails {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly window = inject(DOCUMENT).defaultView;
  private animation?: Animation;

  /** Whether the details are open, as the details button says. */
  readonly expanded = signal(false);
  /** Whether they're in the page: open, or sliding shut. */
  readonly rendered = signal(false);
  /** While they slide: their content is clipped only then, so focus rings aren't. */
  readonly moving = signal(false);

  constructor(
    private readonly body: () => HTMLElement | undefined,
    private readonly button: () => HTMLElement | undefined,
  ) {}

  toggle(): void {
    if (this.expanded()) {
      this.close();
    } else {
      this.open();
    }
  }

  /** Hide details, at the details' foot: closes them and puts focus back on the details button above. */
  collapse(): void {
    this.button()?.focus({ preventScroll: true });
    this.close();
  }

  private open(): void {
    this.expanded.set(true);
    this.rendered.set(true);
    afterNextRender(() => void this.slide('open').then((done) => done && this.keepInView()), {
      injector: this.injector,
    });
  }

  private close(): void {
    this.expanded.set(false);
    void this.slide('shut').then((done) => {
      if (!done) return;
      this.rendered.set(false);
      afterNextRender(() => this.keepInView(), { injector: this.injector });
    });
  }

  /**
   * Slides the details open or shut (M5.7): their grid row from 0fr to 1fr, fading in, or back. With the browser's
   * own Web Animations, since Angular's animate.enter and animate.leave would add 9 kB to the first download. None
   * with reduced motion. False when another click cut it short, which takes over.
   */
  private async slide(way: 'open' | 'shut'): Promise<boolean> {
    const body = this.body();
    this.animation?.cancel();
    if (!body?.animate || this.reducedMotion()) {
      return true;
    }
    const closed = { gridTemplateRows: '0fr', opacity: 0 };
    const open = { gridTemplateRows: '1fr', opacity: 1 };
    const animation = body.animate(way === 'open' ? [closed, open] : [open, closed], {
      duration: way === 'open' ? 200 : 150,
      easing: way === 'open' ? 'ease-out' : 'ease-in',
      // Shut, they stay shut until they leave the page.
      fill: way === 'open' ? 'none' : 'forwards',
    });
    this.animation = animation;
    this.moving.set(true);
    try {
      await animation.finished;
      return true;
    } catch {
      return false;
    } finally {
      if (this.animation === animation) this.moving.set(false);
    }
  }

  /**
   * Once the details have opened or closed, scrolls the card back into view if that left part of it off screen:
   * open, as much of them as fits below the page's pinned bar (the card's scroll-margin); closed from their foot, the
   * card's top, which was scrolled past.
   */
  private keepInView(): void {
    this.host.nativeElement.scrollIntoView?.({
      block: 'nearest',
      behavior: this.reducedMotion() ? 'auto' : 'smooth',
    });
  }

  private reducedMotion(): boolean | undefined {
    return this.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }
}
