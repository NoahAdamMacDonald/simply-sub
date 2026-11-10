import type { WritableSignal } from '@angular/core';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipHarness } from '@angular/material/tooltip/testing';
import {
  quoteLink,
  searchCatalog,
  type CatalogPlan,
  type Settings,
  type SnapshotProvider,
} from '@simply-sub/core';
import { PolicyFiles, type PoliciesLoad } from '../../core/catalog/policy-files';
import { SettingsStore } from '../../core/settings/settings-store';
import { until } from '../../core/storage/storage.testing';
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

/** The provider of the plan `planId`, as the test catalog has it. */
function providerOf(planId: string): SnapshotProvider {
  const providerId = planId.slice(0, planId.indexOf('.'));
  const provider = searchCatalogData.providers.find(({ id }) => id === providerId);
  if (!provider) throw new Error(`No provider ${providerId}`);
  return provider;
}

describe('PlanDetails', () => {
  let fixture: ComponentFixture<PlanDetails>;
  /** The Terms and policies files the card asked for (M11.8), each answered when a spec says. */
  let policyLoads: { providerId: string; answer: (load: PoliciesLoad) => void }[];

  beforeEach(() => {
    policyLoads = [];
    TestBed.configureTestingModule({
      providers: [
        ...searchStores(),
        {
          provide: PolicyFiles,
          useValue: {
            load: (providerId: string) =>
              new Promise<PoliciesLoad>((answer) => policyLoads.push({ providerId, answer })),
          },
        },
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    });
    fixture = TestBed.createComponent(PlanDetails);
  });

  async function show(planId: string, ranks = {}, provider = providerOf(planId)): Promise<void> {
    fixture.componentRef.setInput('provider', provider);
    fixture.componentRef.setInput('match', matchFor(planId));
    fixture.componentRef.setInput('ranks', ranks);
    await fixture.whenStable();
  }

  const element = () => fixture.nativeElement as HTMLElement;
  /**
   * Each group's heading with what's on screen under it in the tab shown, texts joined with spaces as the layout spaces
   * them.
   */
  const groups = () =>
    Array.from(element().querySelectorAll('[role="tabpanel"]:not([hidden]) .group')).map(
      (group) => {
        const copy = group.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('mat-icon, .visually-hidden').forEach((node) => node.remove());
        const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
        const texts: string[] = [];
        while (walker.nextNode()) texts.push(walker.currentNode.textContent?.trim() ?? '');
        return texts.filter(Boolean).join(' ');
      },
    );
  const text = (selector: string) =>
    element().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
  /** The panel of the tab shown. */
  const panel = () => element().querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
  const tabButtons = () =>
    Array.from(element().querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  /** The tabs as the tab list names them: "Features 2". */
  const tabNames = () =>
    tabButtons().map((button) => button.textContent?.replace(/\s+/g, ' ').trim());
  /** Chooses the tab whose name starts with `name`, as a click does. */
  async function tab(name: string): Promise<void> {
    const button = tabButtons().find((candidate) => candidate.textContent?.trim().startsWith(name));
    expect(button, `the ${name} tab`).toBeDefined();
    button?.click();
    await fixture.whenStable();
  }
  /** The group whose heading is `heading`, as groups() gives it. */
  const group = (heading: string) => groups().find((shown) => shown.startsWith(`${heading} `));
  /** Each Ways to pay line's chips by name: a chip of glyphs by its image's name, one with none by its words. */
  const payLines = () =>
    Array.from(panel()?.querySelectorAll('.pay-chips:not(.repo)') ?? []).map((line) =>
      Array.from(line.querySelectorAll('.pay-chip')).map(
        (chip) => chip.getAttribute('aria-label') ?? chip.textContent?.trim(),
      ),
    );

  it('opens on Overview, its highlights those the user ranks first, with a tab for each part that has something', async () => {
    await show('netflix.standard', { 'ad-free': 'needed' });

    expect(tabNames()).toEqual(['Overview', 'Features 2', 'Facts']);
    expect(groups()).toEqual(['Highlights Ad free · Video quality: 1080p (Full HD)']);
    expect(text('.checked')).toBe('Price checked Oct 20, 2026');
  });

  it('lists the features with the user’s ranks, the add-ons and the bundles with their savings', async () => {
    await show('netflix.standard', { 'ad-free': 'needed' });
    await tab('Features');

    expect(groups()).toEqual([
      'Features Video quality: 1080p (Full HD) Ad free Needed',
      'Add-ons Extra member $7.99 / mo + tax',
      // CA$18.99 and CA$22 separately. Crave has no logo: its letter shows.
      'Bundles C Netflix and Crave $35.00 / mo + tax Save $5.99 / mo',
    ]);
    await tab('Facts');
    expect(groups()).toEqual([
      'Billing day The date you signed up , according to its Billing date',
    ]);
  });

  it('moves between its tabs by arrow keys, Home and End, choosing each (WAI-ARIA’s tabs pattern)', async () => {
    await show('mullvad.vpn');
    const press = async (key: string) => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await fixture.whenStable();
    };
    const state = () => [
      tabButtons().indexOf(document.activeElement as HTMLButtonElement),
      tabButtons().map((button) => [button.getAttribute('aria-selected'), button.tabIndex].join()),
    ];

    expect(element().querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(
      'Mullvad VPN details',
    );
    expect(tabNames()).toEqual(['Overview', 'Features 1', 'Terms', 'Facts']);
    tabButtons()[0].focus();
    await press('ArrowRight');
    expect(state()).toEqual([1, ['false,-1', 'true,0', 'false,-1', 'false,-1']]);
    // Its panel shows, named by its tab; the others are hidden.
    const panel = element().querySelector(`#${tabButtons()[1].getAttribute('aria-controls')}`);
    expect([panel?.getAttribute('role'), panel?.getAttribute('aria-labelledby')]).toEqual([
      'tabpanel',
      tabButtons()[1].id,
    ]);
    expect(
      Array.from(element().querySelectorAll('[role="tabpanel"]')).map((each) =>
        each.hasAttribute('hidden'),
      ),
    ).toEqual([true, false, true, true]);
    await press('End');
    expect(state()[0]).toBe(3);
    await press('ArrowRight');
    expect(state()[0]).toBe(0);
    await press('ArrowLeft');
    expect(state()[0]).toBe(3);
    await press('Home');
    expect(state()).toEqual([0, ['true,0', 'false,-1', 'false,-1', 'false,-1']]);
  });

  it('sums up its terms on Overview, and See all opens Terms with its tab focused', async () => {
    await show('mullvad.vpn');

    // The visually hidden " ratings" finishes See all's name for screen readers.
    expect(group('Terms and policies')).toBe('Terms and policies 2 Great 1 not graded See all 3');
    expect(
      Array.from(element().querySelectorAll('.grade-bar span')).map((slice) =>
        slice.getAttribute('data-tier'),
      ),
    ).toEqual(['great', 'great', 'none']);
    expect(element().querySelector('.grade-bar')?.getAttribute('aria-hidden')).toBe('true');
    element().querySelector<HTMLButtonElement>('.see-all')?.click();
    await fixture.whenStable();

    expect(document.activeElement?.textContent?.trim()).toBe('Terms');
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
    expect(groups()[0]).toMatch(/^Terms and policies 2 Great 1 not graded Privacy /);
  });

  it('shows the bundle’s plans by their icons, and its saving to screen readers', async () => {
    await show('crave.premium');
    await tab('Features');
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

    expect(groups()).toEqual(['Highlights VPN', 'Includes Proton VPN Plus · Save $2.49 / mo']);
    expect(text('.checked')).toBe('Price checked Jun 1, 2026 May be out of date');
    await tab('Features');
    expect(groups()).toEqual(['Features VPN']);
    await tab('Facts');
    expect(groups()).toEqual([
      'Includes Proton VPN Plus Save $2.49 / mo against buying them separately',
    ]);
    expect(
      Array.from(element().querySelectorAll('.notes')).map((note) => note.textContent),
    ).toEqual(['Every Proton app, at its paid tier.', 'One Proton account holds one paid plan.']);
  });

  it('leaves out what a plan doesn’t have', async () => {
    await show('netflix.standard-ads');

    expect(tabNames()).toEqual(['Overview', 'Features 1', 'Facts']);
    await tab('Features');
    expect(groups()).toEqual(['Features Video quality: 1080p (Full HD)']);
    expect(element().querySelector('.badge')).toBeNull();
  });

  describe('Terms and policies (M1.13, M1.14, M5.9)', () => {
    it('grades each topic with a dot and in words, says why with citations, by group, and numbers the pages', async () => {
      await show('mullvad.vpn');
      await tab('Terms');

      expect(groups().find((group) => group.startsWith('Terms and policies'))).toBe(
        'Terms and policies 2 Great 1 not graded Privacy Data collection (Not stated): Its no-logging policy doesn’t say what else it collects. [2] ' +
          'Legal Disputes (Great): Swedish courts or the consumer disputes board. [1] ' +
          'Service Activity logging (Great): No connection logs, and an audit found none. [2] ' +
          'Sources [1] Terms of service [2] No-logging policy',
      );
      const dots = Array.from(element().querySelectorAll('.policies .dot'));
      expect(
        Array.from(element().querySelectorAll('.counted .dot')).map((dot) =>
          dot.getAttribute('data-tier'),
        ),
      ).toEqual(['great', 'none']);
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
      await tab('Terms');
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
      await tab('Terms');
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
      const tooltips = await TestbedHarnessEnvironment.loader(fixture).getAllHarnesses(
        MatTooltipHarness.with({ selector: '.policies .cite' }),
      );
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
      await tab('Terms');

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

    it('has no such group, and no Terms tab, for a provider with no ratings', async () => {
      await show('netflix.standard');

      expect(groups().some((group) => group.startsWith('Terms and policies'))).toBe(false);
      expect(tabNames()).not.toContain('Terms');
    });

    describe('in a file of their own (M11.8)', () => {
      const mullvad = providerOf('mullvad.vpn');
      const shown =
        'Terms and policies 2 Great 1 not graded Privacy Data collection (Not stated): Its no-logging policy doesn’t say what else it collects. [2] ' +
        'Legal Disputes (Great): Swedish courts or the consumer disputes board. [1] ' +
        'Service Activity logging (Great): No connection logs, and an audit found none. [2] ' +
        'Sources [1] Terms of service [2] No-logging policy';
      const policyGroups = () =>
        groups().filter((shown) => shown.startsWith('Terms and policies '));

      /** Opens Mullvad's card as data:build writes it since M11.8, a link in place of its policies, until it asks. */
      async function open(): Promise<void> {
        fixture.componentRef.setInput('provider', {
          ...mullvad,
          policies: undefined,
          policiesUrl: 'https://sub.simplely.ca/data/policies/mullvad.json',
        });
        fixture.componentRef.setInput('match', matchFor('mullvad.vpn'));
        fixture.componentRef.setInput('ranks', {});
        await until(() => policyLoads.length === 1);
        tabButtons()
          .find((button) => button.textContent?.trim() === 'Terms')
          ?.click();
        fixture.detectChanges();
      }

      it('loads them as the card opens, saying so meanwhile', async () => {
        await open();

        expect(policyLoads[0].providerId).toBe('mullvad');
        expect(policyGroups()).toEqual(['Terms and policies Loading its terms and policies…']);
        expect(element().querySelector('.policy-note')?.getAttribute('role')).toBe('status');

        policyLoads[0].answer({ status: 'ready', policies: mullvad.policies!, sets: [] });
        await fixture.whenStable();
        expect(policyGroups()).toEqual([shown]);
      });

      it('says they need a connection the first time, and loads them once it’s back', async () => {
        await open();
        policyLoads[0].answer({ status: 'offline' });
        await fixture.whenStable();

        expect(policyGroups()).toEqual([
          'Terms and policies Its terms and policies need a connection the first time: they’ll show once you’re online.',
        ]);

        window.dispatchEvent(new Event('online'));
        await until(() => policyLoads.length === 2);
        policyLoads[1].answer({ status: 'ready', policies: mullvad.policies!, sets: [] });
        await fixture.whenStable();
        expect(policyGroups()).toEqual([shown]);
      });

      it('says when they couldn’t be loaded', async () => {
        await open();
        policyLoads[0].answer({ status: 'failed' });
        await fixture.whenStable();

        expect(policyGroups()).toEqual([
          'Terms and policies Its terms and policies couldn’t be loaded.',
        ]);
        window.dispatchEvent(new Event('online'));
        expect(policyLoads).toHaveLength(1);
      });

      it('shows a provider’s that its catalog file holds, as files from before M11.8 do, without asking', async () => {
        await show('mullvad.vpn');
        await tab('Terms');

        expect(policyGroups()).toEqual([shown]);
        expect(policyLoads).toEqual([]);
      });
    });
  });

  describe('Outside ratings and the owner (M11.2)', () => {
    it('shows each rater’s label with its date and a link, after Terms and policies, then the owner', async () => {
      await show('mullvad.vpn');
      await tab('Terms');

      const terms = groups().findIndex((shown) => shown.startsWith('Terms and policies '));
      expect(terms).toBe(0);
      expect(groups().slice(terms + 1)).toEqual([
        // The rater the catalog doesn't list is left out: its name is unknown.
        'Outside ratings Protection: 6.0/6.0 from Test Lab , August 2026 (tested Mullvad VPN 2026.4, Windows 11) ' +
          'Usability: 5.5/6.0 from Test Lab , Sep 14, 2026',
      ]);
      await tab('Facts');
      expect(groups()[0]).toBe('Owner Mullvad VPN AB · Sweden , according to its About us');
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
      await tab('Facts');
      const link = element().querySelectorAll<HTMLAnchorElement>('.owner a')[1];

      expect([link?.href, link?.target, link?.getAttribute('aria-label')]).toEqual([
        'https://mullvad.net/en/about#:~:text=Mullvad%20VPN%20AB%20is,parent%20company%20Amagicom%20AB.',
        '_blank',
        'About us, opens in a new tab',
      ]);
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTooltipHarness.with({ selector: '.owner a:last-of-type' }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe(
        '“Mullvad VPN AB is owned by parent company Amagicom AB.”',
      );
    });

    it('says where the company is from, linked to its own page, with its words as the tooltip', async () => {
      await show('mullvad.vpn');
      await tab('Facts');
      const link = element().querySelector<HTMLAnchorElement>('.owner a');

      // Shown as "Mullvad VPN AB · Sweden", read as "Mullvad VPN AB, from Sweden": the dot is hidden from screen
      // readers, and the words that replace it are hidden from view.
      expect(element().querySelector('.owner [aria-hidden="true"]')?.textContent).toBe(' · ');
      expect(element().querySelector('.owner .visually-hidden')?.textContent).toBe(', from ');
      const name = link?.querySelector('span')?.textContent;
      expect([name, link?.href, link?.getAttribute('aria-label')]).toEqual([
        'Sweden',
        'https://mullvad.net/en/why-mullvad-vpn#:~:text=a%20VPN%20provider%20based%20in%20Sweden',
        'Sweden, according to its Why Mullvad VPN?, opens in a new tab',
      ]);
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTooltipHarness.with({ selector: '.owner a:first-of-type' }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe('“a VPN provider based in Sweden”');
    });

    it('names the country without a link when the owner’s own words say it', async () => {
      const mullvad = providerOf('mullvad.vpn');
      const owner = mullvad.owner && { ...mullvad.owner, country: { code: 'SE' } };
      await show('mullvad.vpn', {}, { ...mullvad, owner });
      await tab('Facts');

      expect(group('Owner')).toBe('Owner Mullvad VPN AB · Sweden , according to its About us');
      expect(element().querySelectorAll('.owner a')).toHaveLength(1);
    });

    it('gives a public company’s stock symbols and majority holder, citing its own page (2026-11-10)', async () => {
      const mullvad = providerOf('mullvad.vpn');
      const quotes = ['Amagicom AB (NASDAQ Stockholm: AMGC, AMGC.B) is controlled by Bluebird AB.'];
      const owner = mullvad.owner && {
        ...mullvad.owner,
        stock: {
          company: 'Amagicom AB',
          listings: [
            { exchange: 'NASDAQ Stockholm', symbol: 'AMGC' },
            { exchange: 'NASDAQ Stockholm', symbol: 'AMGC.B' },
          ],
          majorityHolder: { name: 'Bluebird AB', percent: 72.5, of: 'votes' as const },
          page: { name: 'Investors', url: 'https://mullvad.net/en/investors' },
          quotes,
          lastVerified: '2026-10-22',
        },
      };
      await show('mullvad.vpn', {}, { ...mullvad, owner });

      // The Overview gives its first listing after where it's from, read as "…, stock symbol NASDAQ Stockholm: AMGC".
      expect(text('.glance-owner')).toBe(
        'Mullvad VPN AB · , from Sweden · , stock symbol NASDAQ Stockholm: AMGC',
      );
      await tab('Facts');
      expect(group('Owner')).toBe(
        'Owner Mullvad VPN AB · Sweden , according to its About us ' +
          'Stock: Amagicom AB, NASDAQ Stockholm: AMGC, AMGC.B; majority holder: Bluebird AB, with 72.5% of the votes ' +
          ', according to its Investors',
      );
      const link = element().querySelectorAll<HTMLAnchorElement>('.owner a')[2];
      expect([link?.href, link?.getAttribute('aria-label')]).toEqual([
        quoteLink('https://mullvad.net/en/investors', quotes),
        'Investors, opens in a new tab',
      ]);
    });

    it('gives the stock with no link of its own when the owner’s words say it', async () => {
      const mullvad = providerOf('mullvad.vpn');
      const owner = mullvad.owner && {
        ...mullvad.owner,
        stock: { listings: [{ exchange: 'NYSE', symbol: 'MLVD' }] },
      };
      await show('mullvad.vpn', {}, { ...mullvad, owner });
      await tab('Facts');

      expect(group('Owner')).toBe(
        'Owner Mullvad VPN AB · Sweden , according to its About us Stock: NYSE: MLVD',
      );
      expect(element().querySelectorAll('.owner a')).toHaveLength(2);
    });

    it('has neither for a provider with none', async () => {
      await show('netflix.standard');
      await tab('Facts');

      expect(groups().some((group) => /^(Outside ratings|Owner) /.test(group))).toBe(false);
      expect(tabNames()).not.toContain('Terms');
    });
  });

  describe('Ways to pay (M11.5)', () => {
    it('lists how a buyer where the user lives can pay, citing the page, its words as the tooltip', async () => {
      await show('mullvad.vpn');
      await tab('Facts');

      // Alberta: Canada's own page over the one for everywhere, then the currencies cash takes (M11.5).
      // No page names the networks its card takes there (the owner's wording, 2026-11-03): its chip says so.
      expect(payLines()).toEqual([['Card (networks not verified)', 'Gift card']]);
      expect(group('Ways to pay')).toBe(
        'Ways to pay networks not verified according to its Vouchers in Canada ' +
          'Cash in EUR, USD or CAD , according to its Terms of service',
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
      await tab('Facts');

      expect(payLines()).toEqual([
        ['Card (networks not verified)', 'PayPal', 'Cash', 'Cryptocurrency'],
      ]);
    });

    it('shows each way to pay as a chip of its glyphs, its name the tooltip, reached by Tab', async () => {
      await show('mullvad.vpn');
      await tab('Facts');
      const chips = panel()?.querySelectorAll<HTMLElement>('.pay-chips .pay-chip') ?? [];

      // A Material Symbol, hidden from screen readers, which read the chip's name instead.
      const gift = chips[1];
      expect([gift?.getAttribute('role'), gift?.tabIndex]).toEqual(['img', 0]);
      expect(gift?.querySelector('mat-icon')?.textContent?.trim()).toBe('card_giftcard');
      expect(gift?.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTooltipHarness.with({
          selector: '[role="tabpanel"]:not([hidden]) .pay-chip:nth-of-type(2)',
        }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe('Gift card');
    });

    it('shows the networks a page names by their marks, and one with none by its name', async () => {
      const mullvad = providerOf('mullvad.vpn');
      const networks = {
        networks: ['visa' as const, 'interac' as const, 'mastercard' as const],
        url: 'https://mullvad.net/en/help/vouchers-ca',
        quotes: ['Visa', 'Interac', 'Mastercard'],
      };
      await show('mullvad.vpn', {}, { ...mullvad, acceptedNetworks: { CA: networks } });
      await tab('Facts');
      const card = panel()?.querySelector('.pay-chip');

      expect(payLines()).toEqual([['Card: Visa, Interac or Mastercard', 'Gift card']]);
      // The card's symbol, then Visa's and Mastercard's marks (Simple Icons, in the text's colour), then Interac,
      // which has none, by name.
      expect(card?.querySelectorAll('mat-icon')).toHaveLength(1);
      expect(
        Array.from(card?.querySelectorAll('svg') ?? []).map((svg) => [
          svg.getAttribute('aria-hidden'),
          svg.querySelector('path')?.getAttribute('fill'),
        ]),
      ).toEqual([
        ['true', 'currentColor'],
        ['true', 'currentColor'],
      ]);
      expect(card?.querySelector(':scope > span')?.textContent).toBe('Interac');
    });

    it('lists each page for the same place, a line each (the owner’s tasks, 2026-11-03)', async () => {
      const mullvad = providerOf('mullvad.vpn');
      const wallets = {
        methods: ['klarna' as const, 'satispay' as const],
        regions: ['CA'],
        page: 'Wallets in Canada',
        url: 'https://mullvad.net/en/help/wallets-ca',
        quotes: ['Klarna', 'Satispay'],
      };
      await show(
        'mullvad.vpn',
        {},
        {
          ...mullvad,
          paymentMethods: [...(mullvad.paymentMethods ?? []), wallets],
        },
      );
      await tab('Facts');

      expect(payLines()).toEqual([
        ['Card (networks not verified)', 'Gift card'],
        ['Klarna', 'Satispay'],
      ]);
      // Satispay has no glyph: its chip shows its name, with no tooltip, and isn't a stop for Tab.
      expect(group('Ways to pay')).toBe(
        'Ways to pay networks not verified according to its Vouchers in Canada ' +
          'Satispay according to its Wallets in Canada ' +
          'Cash in EUR, USD or CAD , according to its Terms of service',
      );
      const satispay = Array.from(panel()?.querySelectorAll<HTMLElement>('.pay-chip') ?? []).find(
        (chip) => chip.textContent?.trim() === 'Satispay',
      );
      expect([satispay?.getAttribute('role'), satispay?.tabIndex]).toEqual([null, -1]);
    });

    it('draws Alipay by its mark (M11.15)', async () => {
      const mullvad = providerOf('mullvad.vpn');
      const wallets = {
        methods: ['alipay' as const],
        regions: ['CA'],
        page: 'Wallets in Canada',
        url: 'https://mullvad.net/en/help/wallets-ca',
        quotes: ['Alipay'],
      };
      await show(
        'mullvad.vpn',
        {},
        { ...mullvad, paymentMethods: [...(mullvad.paymentMethods ?? []), wallets] },
      );
      await tab('Facts');

      expect(payLines()).toEqual([['Card (networks not verified)', 'Gift card'], ['Alipay']]);
      const alipay = Array.from(panel()?.querySelectorAll<HTMLElement>('.pay-chip') ?? []).find(
        (chip) => chip.getAttribute('aria-label') === 'Alipay',
      );
      expect(alipay?.querySelector('svg path')?.getAttribute('fill')).toBe('currentColor');
    });

    it('cites the page naming the currencies, linked to its words', async () => {
      await show('mullvad.vpn');
      await tab('Facts');
      const link = element().querySelectorAll<HTMLAnchorElement>('.payment a')[1];

      expect([link?.href, link?.getAttribute('aria-label')]).toEqual([
        'https://mullvad.net/en/help/terms-service#:~:text=cash%20in%20bills%20(EUR%2C%20USD%2C%20CAD)',
        'Terms of service, opens in a new tab',
      ]);
    });
  });

  describe('Billing day and source code (M11.5)', () => {
    it('says which day it renews on, citing its page with its words as the tooltip', async () => {
      await show('netflix.standard');
      await tab('Facts');

      expect(group('Billing day')).toBe(
        'Billing day The date you signed up , according to its Billing date',
      );
      const link = element().querySelector<HTMLAnchorElement>('.renewal a');
      expect([link?.href, link?.target, link?.getAttribute('aria-label')]).toEqual([
        'https://help.netflix.com/en/node/54896#:~:text=Your%20billing%20cycle%20starts,date%20you%20sign%20up.',
        '_blank',
        'Billing date, opens in a new tab',
      ]);
      const tooltip = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTooltipHarness.with({ selector: '.renewal a' }),
      );
      await tooltip.show();
      expect(await tooltip.getTooltipText()).toBe(
        '“Your billing cycle starts on the date you sign up.”',
      );
    });

    it('says when its pages don’t say, with nothing to cite', async () => {
      await show('netflix.standard');
      await tab('Facts');
      const netflix = searchCatalogData.providers.find(({ id }) => id === 'netflix');
      fixture.componentRef.setInput('provider', {
        ...netflix,
        renewalAnchor: {
          kind: 'not-stated',
          pages: ['https://help.netflix.com/en/node/41049'],
          lastVerified: '2026-10-22',
        },
      });
      await fixture.whenStable();

      expect(group('Billing day')).toBe('Billing day Not stated: its pages don’t say');
      expect(element().querySelector('.renewal a')).toBeNull();
    });

    it('links the repository its own page links, and that page', async () => {
      await show('mullvad.vpn');
      await tab('Facts');

      expect(groups().at(-1)).toBe(
        'Source code github.com/mullvad/mullvadvpn-app , according to its Why Mullvad VPN?',
      );
      const [repo, page] = Array.from(element().querySelectorAll<HTMLAnchorElement>('.repo a'));
      expect([repo?.href, repo?.target, repo?.getAttribute('aria-label')]).toEqual([
        'https://github.com/mullvad/mullvadvpn-app',
        '_blank',
        'Source code on github.com/mullvad/mullvadvpn-app, opens in a new tab',
      ]);
      expect([page?.href, page?.getAttribute('aria-label')]).toEqual([
        'https://mullvad.net/en/why-mullvad-vpn#:~:text=Code%20is%20open%20source',
        'Why Mullvad VPN?, opens in a new tab',
      ]);
      // Its host's chip: GitHub's mark, named GitHub.
      const host = element().querySelector<HTMLElement>('.repo .pay-chip');
      expect([
        host?.getAttribute('aria-label'),
        host?.getAttribute('role'),
        host?.tabIndex,
      ]).toEqual(['GitHub', 'img', 0]);
      expect(host?.querySelector('svg path')?.getAttribute('fill')).toBe('currentColor');
    });

    it('names a host it has no mark for, with the code glyph', async () => {
      const mullvad = providerOf('mullvad.vpn');
      const sourceRepo = mullvad.sourceRepo && {
        ...mullvad.sourceRepo,
        url: 'https://git.example.org/mullvad/app',
      };
      await show('mullvad.vpn', {}, { ...mullvad, sourceRepo });
      await tab('Facts');
      const host = element().querySelector<HTMLElement>('.repo .pay-chip');

      expect([
        host?.getAttribute('aria-label'),
        host?.querySelector('mat-icon')?.textContent,
      ]).toEqual(['git.example.org', 'code']);
    });

    it('has neither for a provider with none', async () => {
      await show('crave.basic');

      expect(tabNames()).not.toContain('Facts');

      expect(group('Billing day')).toBeUndefined();
      expect(group('Source code')).toBeUndefined();
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
