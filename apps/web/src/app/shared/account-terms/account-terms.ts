import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { quoteLink, type Account } from '@simply-sub/core';
import {
  accountKindNames,
  conditionText,
  feesText,
  followedText,
  limitLines,
  protectionText,
  ratesText,
  waiversText,
} from './account-text';

/**
 * A finance account's terms on its card (M11.10, BLUEPRINT §4.11): what it is, its posted interest, how soon it
 * followed the Bank of Canada's last changes (M11.14), what waives its fee, its limits, its other fees and what protects
 * the money (each linked to the provider's words), and who may open it.
 */
@Component({
  selector: 'ss-account-terms',
  imports: [MatIcon, MatTooltip],
  templateUrl: './account-terms.html',
  styleUrl: './account-terms.scss',
})
export class AccountTerms {
  readonly account = input.required<Account>();
  /** The user's country, for how money is written. */
  readonly country = input<string | undefined>(undefined);

  protected readonly kind = computed(() => accountKindNames[this.account().kind]);
  protected readonly rates = computed(() => {
    const { rates, currency } = this.account();
    return rates && { text: ratesText(rates, currency, this.country()), url: rates.sourceUrl };
  });
  /** How soon a rate that moves with the Bank of Canada's followed its last changes, as data:build worked it out. */
  protected readonly followed = computed(() => {
    const followed = this.account().rates?.followed;
    return followed && followed.length > 0 ? followedText(followed) : undefined;
  });
  protected readonly waivers = computed(() => {
    const { waivers, currency } = this.account();
    return waivers && waiversText(waivers, currency, this.country());
  });
  protected readonly limits = computed(() => {
    const { limits, currency } = this.account();
    return limits ? limitLines(limits, currency, this.country()) : [];
  });
  protected readonly protection = computed(() => {
    const { protection, currency } = this.account();
    return {
      text: protectionText(protection, currency, this.country()),
      href: quoteLink(protection.url, protection.quotes),
      tooltip: protection.quotes.map((quote) => `“${quote}”`).join(' '),
    };
  });
  /** Its other fees (2026-11-10), linked to its fee page scrolled to its words. */
  protected readonly fees = computed(() => {
    const { fees, currency } = this.account();
    return (
      fees && {
        text: feesText(fees, currency, this.country()),
        href: quoteLink(fees.url, fees.quotes),
        tooltip: fees.quotes.map((quote) => `“${quote}”`).join(' '),
      }
    );
  });
  protected readonly eligibility = computed(() => {
    const { eligibility, currency } = this.account();
    return eligibility && `Open to you if ${conditionText(eligibility, currency, this.country())}`;
  });
}
