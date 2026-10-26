import { Component, booleanAttribute, computed, input, model } from '@angular/core';
import { MatFormField } from '@angular/material/form-field';
import { MatOption, MatSelect, MatSelectTrigger } from '@angular/material/select';
import { rankChoices, type Rank } from '@simply-sub/core';
import { RankDot } from './rank-dot';
import { rankHints, rankNames } from './rank-text';

/** The value of the "Profile default" option, which isn't a rank. */
const profileDefault = 'profile-default';

/**
 * The single rank dropdown (BLUEPRINT §8.3): each choice with its colour dot. On the Features page it ranks a profile
 * (Not ranked first, muted, as the default). With `subscriptionLevel` it adds Essential and Critical with their hints,
 * and with `inherited` (an item's override) it starts with "Profile default (Wanted)", which shows the profile's rank
 * and sets the value to undefined: no override. Name it with `labelledBy` (the row's visible name) or `label`.
 */
@Component({
  selector: 'ss-rank-select',
  imports: [MatFormField, MatOption, MatSelect, MatSelectTrigger, RankDot],
  templateUrl: './rank-select.html',
  styleUrl: './rank-select.scss',
})
export class RankSelect {
  /** The chosen rank. Undefined is the profile default with `inherited`, and Not ranked without it. */
  readonly value = model<Rank | undefined>();
  readonly subscriptionLevel = input(false, { transform: booleanAttribute });
  /** The profile's rank for the key, which an item without an override takes. */
  readonly inherited = input<Rank>();
  /** The id of the element that names the dropdown. */
  readonly labelledBy = input<string>();
  /** The dropdown's name, when nothing on screen names it. */
  readonly label = input<string>();

  protected readonly names = rankNames;
  protected readonly profileDefault = profileDefault;
  protected readonly choices = computed(() =>
    rankChoices(this.subscriptionLevel() ? 'subscription' : 'profile').map((rank) => ({
      rank,
      name: rankNames[rank],
      hint: rankHints[rank],
    })),
  );
  protected readonly selected = computed(
    () => this.value() ?? (this.inherited() === undefined ? 'not-ranked' : profileDefault),
  );
  /** The rank whose dot the closed dropdown shows. */
  protected readonly shown = computed(() => this.value() ?? this.inherited() ?? 'not-ranked');
  /** The choice is a default (the profile's, or Not ranked on a profile), shown muted so real choices stand out. */
  protected readonly muted = computed(
    () =>
      this.selected() === profileDefault ||
      (!this.subscriptionLevel() && this.shown() === 'not-ranked'),
  );
  protected readonly triggerText = computed(() => {
    const inherited = this.inherited();
    return this.selected() === profileDefault && inherited !== undefined
      ? `Profile default (${rankNames[inherited]})`
      : rankNames[this.shown()];
  });

  protected choose(choice: Rank | typeof profileDefault): void {
    this.value.set(choice === profileDefault ? undefined : choice);
  }
}
