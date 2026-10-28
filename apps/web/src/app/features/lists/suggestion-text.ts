import { actionTitle, type PickedPrice, type SuggestionAction } from '@simply-sub/core';
import { dateText } from '../../shared/date-text';

// What a P14 card says about each change: core's title, the prices it goes from and to, and when it happens.

export interface ActionLine {
  title: string;
  /** What the items it changes cost now, a charge each. */
  from: PickedPrice[];
  /** What it costs after, a charge: none for a removal. */
  to?: PickedPrice;
  /** When it takes effect: on the item's next charge. */
  when: string;
}

export function actionLine(action: SuggestionAction): ActionLine {
  const title = actionTitle(action);
  switch (action.kind) {
    case 'interval':
    case 'downgrade':
    case 'switch':
      return {
        title,
        from: [action.item.price],
        to: action.to,
        when: `From ${dateText(action.on)}`,
      };
    case 'remove':
      return {
        title,
        from: [action.item.price],
        when: `Ends ${dateText(action.on)} instead of renewing`,
      };
    case 'extra-member':
      return {
        title,
        from: [action.item.price],
        to: action.to,
        when: `From ${dateText(action.on)}`,
      };
    case 'bundle':
    case 'suite':
      return {
        title,
        from: action.items.map((item) => item.price),
        to: action.to,
        when: `From ${dateText(action.on)}, as each one ends`,
      };
    case 'card':
      // Nothing it costs changes but what comes back: the card says where the saving comes from (M9.3).
      return {
        title,
        from: [],
        when: `With ${action.cardTitle} instead of ${action.fromCardTitle ?? 'no card'}, from now on`,
      };
  }
}
