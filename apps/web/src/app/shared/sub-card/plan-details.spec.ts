import type { WritableSignal } from '@angular/core';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
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
    await show('netflix.standard', { 'streaming.ad-free': 'needed' });

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

  describe('Terms and policies (M1.13, M1.14)', () => {
    it('grades each topic with a dot, says why with citations, by group, and numbers the pages', async () => {
      await show('mullvad.vpn');

      expect(groups().at(-1)).toBe(
        'Terms and policies Legal Disputes: Swedish courts or the consumer disputes board. [1] ' +
          'Service VPN logging: No connection logs, and an audit found none. [2] ' +
          'Sources [1] Terms of service [2] No-logging policy',
      );
      const grades = Array.from(element().querySelectorAll('.grade'));
      expect(grades.map((grade) => [grade.getAttribute('data-tier'), grade.ariaLabel])).toEqual([
        ['great', 'Great'],
        ['great', 'Great'],
      ]);
      const link = element().querySelector<HTMLAnchorElement>('.policy-links a');
      expect([link?.href, link?.target, link?.rel]).toEqual([
        'https://mullvad.net/en/help/terms-service',
        '_blank',
        'noopener',
      ]);
      expect(link?.querySelector('.visually-hidden')?.textContent).toBe(', opens in a new tab');
    });

    it('cites each page a rating quotes, linked to the words, with the quote as its tooltip', async () => {
      await show('mullvad.vpn');
      const cite = element().querySelector<HTMLAnchorElement>('.cite');

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
      await tooltips[1].show();
      expect(await tooltips[1].getTooltipText()).toBe(
        '“shall be handled by the National Board for Consumer Disputes (ARN) or the Swedish courts” ' +
          '(Terms of service)',
      );
    });

    it('shows the grade when the dot is clicked or tapped, and keeps it there', async () => {
      await show('mullvad.vpn');
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(MatTooltipHarness);
      const dot = element().querySelector<HTMLButtonElement>('.grade');

      dot?.click();
      await fixture.whenStable();
      expect(await tooltip.isOpen()).toBe(true);
      expect(await tooltip.getTooltipText()).toBe('Great');
      // A click on the trigger is outside the tooltip, which hides it after 0 ms unless show() cancels that.
      dot?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fixture.whenStable();
      expect(await tooltip.isOpen()).toBe(true);
    });

    it('shows a rating for the user’s country over the one for everywhere', async () => {
      const saved = TestBed.inject(SettingsStore).saved as WritableSignal<Settings | undefined>;
      saved.set({ ...alberta, country: 'US', subdivision: undefined, currency: 'USD' });
      await show('mullvad.vpn');

      expect(element().querySelector('.grade')?.ariaLabel).toBe('Bad');
      expect(groups().at(-1)).toBe(
        'Terms and policies Legal Disputes: A made-up US rule, for the test. [1] ' +
          'Service VPN logging: No connection logs, and an audit found none. [2] ' +
          'Sources [1] Terms of service [2] No-logging policy',
      );
    });

    it('has no such group for a provider with no ratings', async () => {
      await show('netflix.standard');

      expect(groups().some((group) => group.startsWith('Terms and policies'))).toBe(false);
    });
  });
});
