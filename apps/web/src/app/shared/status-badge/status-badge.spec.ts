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
      text: 'Active Manual · renew by Nov 3',
    },
    // One that renews by itself says when (M6.12); one that starts later doesn't renew yet.
    {
      status: { kind: 'active', manual: false },
      nextCharge: '2026-11-03',
      text: 'Active Auto-renews Nov 3',
    },
    // A renewal and the end together, in one badge (M6.19); no renewal on or after the end.
    {
      status: { kind: 'active', endsOn: '2026-11-28', manual: false },
      nextCharge: '2026-11-12',
      text: 'Active Renews Nov 12, then ends Nov 28',
    },
    {
      status: { kind: 'active', endsOn: '2026-11-28', manual: true },
      nextCharge: '2026-11-12',
      text: 'Active Manual · renew by Nov 12, then ends Nov 28',
    },
    {
      status: { kind: 'active', endsOn: '2026-11-28', manual: false },
      nextCharge: '2026-11-28',
      text: 'Active Ends Nov 28',
    },
    {
      status: { kind: 'inactive', activeFrom: '2026-11-03', manual: false },
      nextCharge: '2026-11-03',
      text: 'Inactive · active from Nov 3, 2026',
    },
  ])('$text', async ({ status, nextCharge, text }) => {
    expect(await shown(status, nextCharge)).toBe(text);
  });

  it('says what takes over in place of the renewal and the end (M7.11)', async () => {
    fixture.componentRef.setInput('replacement', 'Moves to Netflix and Crave on Nov 15');
    expect(await shown({ kind: 'active', endsOn: '2026-11-15', manual: false }, '2026-11-12')).toBe(
      'Active Moves to Netflix and Crave on Nov 15',
    );
  });

  it('colours the dot by the status, and hides it from screen readers', async () => {
    await shown({ kind: 'inactive', manual: false });
    const status = (fixture.nativeElement as HTMLElement).querySelector('.status');
    expect(status?.getAttribute('data-kind')).toBe('inactive');
    expect(status?.querySelector('.dot')?.getAttribute('aria-hidden')).toBe('true');
  });
});
