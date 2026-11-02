import { quoteLink } from './plan-policies';
import type { Provider } from './provider';
import {
  ratingSubjectSchema,
  ratingSubjects,
  type Owner,
  type Rater,
  type RatingSubject,
} from './rater';

// What a card's Outside ratings and Owner show (M11.2, BLUEPRINT §4.10): each rater's label, its date and a link to
// the rater's page, never its text; and the company behind the provider, citing its own page.

export interface OutsideRatingEntry {
  /** As the card credits it (AV-TEST). */
  rater: string;
  label: string;
  /** The rater's date: a day, or a lab test's month (YYYY-MM). */
  date: string;
  url: string;
  /** What the rater tested, when that isn't simply the provider (Total Security 27.0, Windows 11). */
  tested?: string;
}

export interface OutsideRatingGroup {
  subject: RatingSubject;
  /** As the card names it (Protection). */
  name: string;
  ratings: OutsideRatingEntry[];
}

/**
 * A provider's outside ratings by subject, in core's order of subjects and the provider's order of raters within one.
 * A rating whose rater the catalog doesn't list is left out, since its name is unknown.
 */
export function outsideRatings(
  provider: Pick<Provider, 'ratings'>,
  raters: readonly Rater[] = [],
): OutsideRatingGroup[] {
  const names = new Map(raters.map((rater) => [rater.id, rater.name]));
  return ratingSubjectSchema.options.flatMap((subject) => {
    const ratings = (provider.ratings ?? []).flatMap((rating) => {
      const rater = names.get(rating.rater);
      return rating.subject === subject && rater
        ? [
            {
              rater,
              label: rating.label,
              date: rating.date,
              url: rating.url,
              ...(rating.tested && { tested: rating.tested }),
            },
          ]
        : [];
    });
    return ratings.length > 0 ? [{ subject, name: ratingSubjects[subject].name, ratings }] : [];
  });
}

export interface OwnerCitation {
  name: string;
  /** The page's name, as the card links it. */
  page: string;
  /** The page with a text fragment that scrolls to the quotes (core's quoteLink). */
  href: string;
  quotes: string[];
}

/** The company behind a provider, and a link to its own words that say so. */
export function ownerCitation(owner: Owner): OwnerCitation {
  return {
    name: owner.name,
    page: owner.page.name,
    href: quoteLink(owner.page.url, owner.quotes),
    quotes: owner.quotes,
  };
}
