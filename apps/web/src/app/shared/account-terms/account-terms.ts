import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { quoteLink, type Account } from '@simply-sub/core';
import {
  accountKindNames,
  conditionText,
  limitLines,
  protectionText,
  ratesText,
  waiversText,
} from './account-text';

/**
 * A finance account's terms on its card (M11.10, BLUEPRINT §4.11): what it is, its posted interest, what waives its
 * fee, its limits, what protects the money (linked to the provider's words), and who may open it.
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
  protected readonly eligibility = computed(() => {
    const { eligibility, currency } = this.account();
    return eligibility && `Open to you if ${conditionText(eligibility, currency, this.country())}`;
  });
}
