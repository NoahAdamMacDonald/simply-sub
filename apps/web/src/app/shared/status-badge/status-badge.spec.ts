import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { StatusBadge, type BadgeStatus } from './status-badge';

describe('StatusBadge', () => {
  let fixture: ComponentFixture<StatusBadge>;

  beforeEach(() => {
    fixture = TestBed.createComponent(StatusBadge);
  });

  /** What's on screen, without the icon's ligature. */
  async function shown(status: BadgeStatus, nextCharge?: string): Promise<string> {
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('nextCharge', nextCharge);
    await fixture.whenStable();
    const copy = (fixture.nativeElement as HTMLElement).cloneNode(true) as HTMLElement;
    copy.querySelectorAll('mat-icon').forEach((icon) => icon.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it.each<{ status: BadgeStatus; nextCharge?: string; text: string }>([
    { status: { kind: 'active', manual: false }, text: 'Active' },
    { status: { kind: 'inactive', manual: false }, text: 'Inactive' },
    {
      status: { kind: 'inactive', activeFrom: '2027-09-10', manual: false },
      text: 'Inactive · active from Sep 10, 2027',
    },
    { status: { kind: 'not-listed' }, text: 'Not listed' },
    { status: { kind: 'active', endsOn: '2026-11-03', manual: false }, text: 'Active Ends Nov 3' },
    {
      status: { kind: 'active', manual: true },
      nextCharge: '2026-11-03',
      text: 'Active Renew by Nov 3',
    },
  ])('$text', async ({ status, nextCharge, text }) => {
    expect(await shown(status, nextCharge)).toBe(text);
  });

  it('colours the dot by the status, and hides it from screen readers', async () => {
    await shown({ kind: 'inactive', manual: false });
    const status = (fixture.nativeElement as HTMLElement).querySelector('.status');
    expect(status?.getAttribute('data-kind')).toBe('inactive');
    expect(status?.querySelector('.dot')?.getAttribute('aria-hidden')).toBe('true');
  });
});
