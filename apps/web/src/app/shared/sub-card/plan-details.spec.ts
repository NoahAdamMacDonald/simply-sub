import type { WritableSignal } from '@angular/core';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import { searchCatalog, type CatalogPlan, type Settings } from '@simply-sub/core';
import { SettingsStore } from '../../core/settings/settings-store';
import { PlanDetails } from './plan-details';
import { alberta, fx, searchCatalogData, searchStores, today } from './search.testing';

/** A plan as Search's results give it, matched by every plan of its provider. */
function matchFor(planId: string): CatalogPlan {
  for (const result of searchCatalog(
    {},
    { catalog: searchCatalogData, settings: alberta, fx, items: [], today },
  )) {
    const found = result.kind === 'priced' && result.plans.find(({ plan }) => plan.id === planId);
    if (found) return found;
  }
  throw new Error(`No plan ${planId}`);
}

describe('PlanDetails', () => {
  let fixture: ComponentFixture<PlanDetails>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...searchStores(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(PlanDetails);
  });

  async function show(planId: string, ranks = {}): Promise<void> {
    const providerId = planId.slice(0, planId.indexOf('.'));
    const provider = searchCatalogData.providers.find(({ id }) => id === providerId);
    fixture.componentRef.setInput('provider', provider);
    fixture.componentRef.setInput('match', matchFor(planId));
    fixture.componentRef.setInput('ranks', ranks);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  /** Each group's heading with what's on screen under it, texts joined with spaces as the layout spaces them. */
  const groups = () =>
    Array.from(element().querySelectorAll('.group')).map((group) => {
      const copy = group.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('mat-icon, .visually-hidden').forEach((node) => node.remove());
      const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
      const texts: string[] = [];
      while (walker.nextNode()) texts.push(walker.currentNode.textContent?.trim() ?? '');
      return texts.filter(Boolean).join(' ');
    });
  const text = (selector: string) =>
    element().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

  it('lists the features with the user’s ranks, the add-ons and the bundles with their savings', async () => {
    await show('netflix.standard', { 'ad-free': 'needed' });

    expect(groups()).toEqual([
      'Features Video quality: 1080p (Full HD) Ad free Needed',
      'Add-ons Extra member $7.99 / mo + tax',
      // CA$18.99 and CA$22 separately. Crave has no logo: its letter shows.
      'Bundles C Netflix and Crave $35.00 / mo + tax Save $5.99 / mo',
    ]);
    expect(text('.checked')).toBe('Price checked Oct 20, 2026');
  });

  it('shows the bundle’s plans by their icons, and its saving to screen readers', async () => {
    await show('crave.premium');
    const bundle = element().querySelector('.rows li');

    expect(
      Array.from(bundle?.querySelectorAll('ss-provider-icon') ?? []).map(
        (icon) => icon.querySelector('img')?.getAttribute('src') ?? icon.textContent?.trim(),
      ),
    ).toEqual(['icons/netflix.webp', 'C']);
    expect(bundle?.querySelector('.saving')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Save $5.99 / mo a month',
    );
    expect(groups()).toContain('Perks HBO Max originals');
  });

  it('lists what a suite includes and what it saves, its notes, and a price that may be out of date', async () => {
    await show('proton.unlimited');

    expect(groups()).toEqual([
      'Features VPN',
      'Includes Proton VPN Plus Save $2.49 / mo against buying them separately',
    ]);
    expect(
      Array.from(element().querySelectorAll('.notes')).map((note) => note.textContent),
    ).toEqual(['Every Proton app, at its paid tier.', 'One Proton account holds one paid plan.']);
    expect(text('.checked')).toBe('Price checked Jun 1, 2026 May be out of date');
  });

  it('leaves out what a plan doesn’t have', async () => {
    await show('netflix.standard-ads');

    expect(groups()).toEqual(['Features Video quality: 1080p (Full HD)']);
    expect(element().querySelector('.badge')).toBeNull();
  });

  describe('Terms and policies (M1.13, M1.14, M5.9)', () => {
    it('grades each topic with a dot and in words, says why with citations, by group, and numbers the pages', async () => {
      await show('mullvad.vpn');

      expect(groups().find((group) => group.startsWith('Terms and policies'))).toBe(
        'Terms and policies Privacy Data collection (Not stated): Its no-logging policy doesn’t say what else it collects. [2] ' +
          'Legal Disputes (Great): Swedish courts or the consumer disputes board. [1] ' +
          'Service Activity logging (Great): No connection logs, and an audit found none. [2] ' +
          'Sources [1] Terms of service [2] No-logging policy',
      );
      const dots = Array.from(element().querySelectorAll('.policies .dot'));
      expect(dots.map((dot) => [dot.getAttribute('data-tier'), dot.ariaHidden])).toEqual([
        ['none', 'true'],
        ['great', 'true'],
        ['great', 'true'],
      ]);
      const link = element().querySelector<HTMLAnchorElement>('.policy-links a');
      expect([link?.href, link?.target, link?.rel]).toEqual([
        'https://mullvad.net/en/help/terms-service',
        '_blank',
        'noopener',
      ]);
      expect(link?.getAttribute('aria-label')).toMatch(/^\[1\] .+, opens in a new tab$/);
    });

    it('shows a topic the pages don’t address as a grey Not stated line, citing the page read (M11.1)', async () => {
      await show('mullvad.vpn');
      const line = element().querySelector('.policies li');

      expect(line?.classList.contains('unrated')).toBe(true);
      expect(line?.querySelector('.grade')?.textContent?.trim()).toBe('(Not stated):');
      expect(line?.querySelector<HTMLAnchorElement>('.cite')?.href).toBe(
        'https://mullvad.net/en/help/no-logging-data-policy',
      );
      expect(element().querySelectorAll('.policies li.unrated')).toHaveLength(1);
    });

    it('cites each page a rating quotes, linked to the words, with the quote as its tooltip', async () => {
      await show('mullvad.vpn');
      // The first graded line's: the Not stated line before it cites the page it read.
      const cite = element().querySelector<HTMLAnchorElement>('.policies li:not(.unrated) .cite');

      expect([cite?.href, cite?.target, cite?.rel]).toEqual([
        'https://mullvad.net/en/help/terms-service#:~:text=shall%20be%20handled%20by,or%20the%20Swedish%20courts',
        '_blank',
        'noopener',
      ]);
      expect(cite?.querySelector('.visually-hidden')?.textContent).toBe(
        ' Terms of service, opens in a new tab',
      );
      const tooltips =
        await TestbedHarnessEnvironment.loader(fixture).getAllHarnesses(MatTooltipHarness);
      // A page read that's silent on the topic is named alone.
      await tooltips[0].show();
      expect(await tooltips[0].getTooltipText()).toBe('No-logging policy');
      await tooltips[0].hide();
      await tooltips[1].show();
      expect(await tooltips[1].getTooltipText()).toBe(
        '“shall be handled by the National Board for Consumer Disputes (ARN) or the Swedish courts” ' +
          '(Terms of service)',
      );
    });

    it('shows a rating for the user’s country over the one for everywhere', async () => {
      const saved = TestBed.inject(SettingsStore).saved as WritableSignal<Settings | undefined>;
      saved.set({ ...alberta, country: 'US', subdivision: undefined, currency: 'USD' });
      await show('mullvad.vpn');

      expect(text('.policies li:not(.unrated) .rated')).toContain(
        'Disputes (Bad): A made-up US rule, for the test.',
      );
      // Where to change it (M5.12): the provider's own page, in a new tab, named in one piece.
      const action = element().querySelector<HTMLAnchorElement>('.policies .action');
      expect([action?.href, action?.target, action?.rel]).toEqual([
        'https://mullvad.net/en/help/opt-out',
        '_blank',
        'noopener',
      ]);
      expect(action?.getAttribute('aria-label')).toBe('How to opt out, opens in a new tab');
    });

    it('has no such group for a provider with no ratings', async () => {
      await show('netflix.standard');

      expect(groups().some((group) => group.startsWith('Terms and policies'))).toBe(false);
    });
  });

  describe('Outside ratings and the owner (M11.2)', () => {
    it('shows each rater’s label with its date and a link, after Terms and policies, then the owner', async () => {
      await show('mullvad.vpn');

      expect(groups().slice(-4, -3)[0]).toMatch(/^Terms and policies /);
      expect(groups().slice(-3, -1)).toEqual([
        // The rater the catalog doesn't list is left out: its name is unknown.
        'Outside ratings Protection: 6.0/6.0 from Test Lab , August 2026 (tested Mullvad VPN 2026.4, Windows 11) ' +
          'Usability: 5.5/6.0 from Test Lab , Sep 14, 2026',
        'Owner Mullvad VPN AB , according to its About us',
      ]);
      const link = element().querySelector<HTMLAnchorElement>('.outside a');
      expect([link?.href, link?.target, link?.rel, link?.getAttribute('aria-label')]).toEqual([
        'https://lab.example.org/mullvad',
        '_blank',
        'noopener',
        'Test Lab’s rating, opens in a new tab',
      ]);
    });

    it('cites the owner’s own page, linked to its words, with them as the tooltip', async () => {
      await show('mullvad.vpn');
      const link = element().querySelector<HTMLAnchorElement>('.owner a');

      expect([link?.href, link?.target, link?.getAttribute('aria-label')]).toEqual([
        'https://mullvad.net/en/about#:~:text=Mullvad%20VPN%20AB%20is,parent%20company%20Amagicom%20AB.',
        '_blank',
        'About us, opens in a new tab',
      ]);
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTooltipHarness.with({ selector: '.owner a' }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe(
        '“Mullvad VPN AB is owned by parent company Amagicom AB.”',
      );
    });

    it('has neither for a provider with none', async () => {
      await show('netflix.standard');

      expect(groups().some((group) => /^(Outside ratings|Owner) /.test(group))).toBe(false);
    });
  });

  describe('Ways to pay (M11.5)', () => {
    it('lists how a buyer where the user lives can pay, citing the page, its words as the tooltip', async () => {
      await show('mullvad.vpn');

      // Alberta: Canada's own page over the one for everywhere.
      expect(groups().at(-1)).toBe(
        'Ways to pay Card and Gift card , according to its Vouchers in Canada',
      );
      const link = element().querySelector<HTMLAnchorElement>('.payment a');
      expect([link?.href, link?.target, link?.getAttribute('aria-label')]).toEqual([
        'https://mullvad.net/en/help/vouchers-ca#:~:text=credit%20card&text=voucher',
        '_blank',
        'Vouchers in Canada, opens in a new tab',
      ]);
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTooltipHarness.with({ selector: '.payment a' }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe('“credit card” “voucher”');
    });

    it('takes the page for everywhere elsewhere', async () => {
      const saved = TestBed.inject(SettingsStore).saved as WritableSignal<Settings | undefined>;
      saved.set({ ...alberta, country: 'US', subdivision: undefined, currency: 'USD' });
      await show('mullvad.vpn');

      expect(groups().at(-1)).toBe(
        'Ways to pay Card, PayPal, Cash and Cryptocurrency , according to its Payment methods',
      );
    });
  });
  it('offers Report a wrong price beside the price’s date, and thanks the user once a report is sent', async () => {
    await show('netflix.standard');
    await (
      await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatButtonHarness.with({ text: 'Report a wrong price' }),
      )
    ).click();
    // Its dialog loads as it opens.
    await vi.waitFor(() =>
      expect(document.querySelector('ss-report-price-dialog')?.textContent).toContain(
        'Netflix Standard in Canada.',
      ),
    );
    TestBed.inject(MatDialog).openDialogs[0].close(true);
    await vi.waitFor(() =>
      expect(document.querySelector('.mat-mdc-snack-bar-container')?.textContent).toContain(
        'Thanks. Netflix’s page will be checked tonight.',
      ),
    );
    TestBed.inject(MatSnackBar).dismiss();
  });
});
