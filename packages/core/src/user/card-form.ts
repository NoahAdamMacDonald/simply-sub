import type { CardNetwork } from '../catalog/provider';
import {
  looksLikeCardNumber,
  maxCashbackPercent,
  maxFxFeePercent,
  maxMonthlyLimit,
} from './card-rules';
import { parseAmount } from './custom-sub-form';
import type { FormIssue } from './item-form';
import type { PaymentCard } from './payment-card';

// The card dialog's rules (PROJECT-PLAN P11, M9.1): its fields, exactly BLUEPRINT §9.2's, what they need before the
// card is saved, and the card it saves. No field takes a card number: 12 or more digits in a row are refused in every
// one, the number fields too, which are typed as text. The dialog holds the form; what it decides is here.

/** The longest name and nickname a card can have. */
export const maxCardNameLength = 60;

/**
 * The card dialog's form. Signal Forms models hold no undefined, so a field not filled in is ''. The percentages and
 * the limit are text, as the custom subscription editor's costs are (CustomPlanForm.amount).
 */
export interface CardForm {
  name: string;
  nickname: string;
  type: PaymentCard['type'] | '';
  network: CardNetwork | '';
  /** The card's home currency: the user's for a new card. */
  currency: string;
  /** '' is none. */
  cashbackPercent: string;
  /** '' is none: a no-FX card. */
  fxFeePercent: string;
  /** '' is no limit. */
  monthlyLimit: string;
}

/** What the dialog saves: all of a card but its id and timestamps. */
export type CardFields = Omit<PaymentCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** A new card's form: nothing chosen but the user's currency (P11). */
export function newCardForm(currency: string): CardForm {
  return {
    name: '',
    nickname: '',
    type: '',
    network: '',
    currency,
    cashbackPercent: '',
    fxFeePercent: '',
    monthlyLimit: '',
  };
}

/** The form for a saved card. */
export function cardFormFor(card: PaymentCard): CardForm {
  return {
    name: card.name,
    nickname: card.nickname ?? '',
    type: card.type,
    network: card.network,
    currency: card.currency,
    cashbackPercent: String(card.cashbackPercent),
    fxFeePercent: String(card.fxFeePercent),
    monthlyLimit: card.monthlyLimit === undefined ? '' : String(card.monthlyLimit),
  };
}

/**
 * Everything that stops the form from being saved, at the field it's about (P11): a name, a type, a network and a
 * currency; cash back from 0 to 20%, an FX fee from 0 to 10% and a limit above 0, when they're filled in; at most 60
 * characters in a name or nickname; and in no field 12 or more digits in a row, which could be a card number.
 */
export function cardFormIssues(form: CardForm): FormIssue[] {
  const issues: FormIssue[] = [];
  const add = (field: keyof CardForm, message: string) => issues.push({ path: [field], message });
  const texts = ['name', 'nickname', 'cashbackPercent', 'fxFeePercent', 'monthlyLimit'] as const;
  const cardNumbers = new Set(texts.filter((field) => looksLikeCardNumber(form[field])));
  for (const field of cardNumbers) add(field, 'Never enter a card number');

  for (const field of ['name', 'nickname'] as const) {
    if (cardNumbers.has(field)) continue;
    if (form[field].trim().length > maxCardNameLength) {
      add(field, `Use at most ${maxCardNameLength} characters`);
    }
  }
  if (!cardNumbers.has('name') && form.name.trim() === '') add('name', 'Give the card a name');
  if (form.type === '') add('type', 'Choose credit or debit');
  if (form.network === '') add('network', 'Choose its network');
  if (form.currency === '') add('currency', 'Choose a currency');

  const percent = (field: 'cashbackPercent' | 'fxFeePercent', max: number) => {
    if (cardNumbers.has(field) || form[field].trim() === '') return;
    const value = parseAmount(form[field]);
    if (value === undefined || value > max) add(field, `Enter a percentage from 0 to ${max}`);
  };
  percent('cashbackPercent', maxCashbackPercent);
  percent('fxFeePercent', maxFxFeePercent);
  if (!cardNumbers.has('monthlyLimit') && form.monthlyLimit.trim() !== '') {
    const limit = parseAmount(form.monthlyLimit);
    if (limit === undefined || limit <= 0 || limit > maxMonthlyLimit) {
      add('monthlyLimit', 'Enter an amount above 0, or leave it empty for no limit');
    }
  }
  return issues;
}

/** The card a valid form describes (cardFormIssues finds nothing), trimmed: an empty percentage is 0. */
export function cardFromForm(form: CardForm): CardFields {
  const nickname = form.nickname.trim();
  const limit = form.monthlyLimit.trim();
  return {
    name: form.name.trim(),
    ...(nickname !== '' && { nickname }),
    type: form.type || 'credit',
    network: form.network || 'other',
    currency: form.currency,
    cashbackPercent: parseAmount(form.cashbackPercent) ?? 0,
    fxFeePercent: parseAmount(form.fxFeePercent) ?? 0,
    ...(limit !== '' && { monthlyLimit: parseAmount(limit) ?? 0 }),
  };
}
