import { Component, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { categoryCoverage } from '@simply-sub/core';
import { CatalogStore } from '../../core/catalog/catalog-store';
import { ClockService } from '../../core/clock/clock-service';

/** One category's chip: its icon, and whether the plan picked is in it. */
interface CategoryChip {
  id: string;
  name: string;
  icon: string;
  inPlan: boolean;
}

const names = new Intl.ListFormat('en', { type: 'conjunction' });

/**
 * A card's categories (M10.36, the owner's feedback): an icon chip for each category the provider's plans are in, the
 * picked plan's filled, with a check, and the others outlined and muted, in categories.yaml's order so switching plans
 * moves no chip. The row is one tab stop: hovering or focusing it names them all in a tooltip ("This plan: VPN. Its
 * other plans: Password managers & authenticators."), which is also its name for screen readers. Search's card
 * (ss-sub-card) and List view's (ss-item-card) show it.
 */
@Component({
  selector: 'ss-category-chips',
  imports: [MatIcon, MatTooltip],
  templateUrl: './category-chips.html',
  styleUrl: './category-chips.scss',
})
export class CategoryChips {
  private readonly catalog = inject(CatalogStore);
  private readonly today = inject(ClockService).today;

  /** The provider, with its plans. */
  readonly provider = input.required<Parameters<typeof categoryCoverage>[0]>();
  /** The plan picked, whose categories are filled; none, when no plan is. */
  readonly planId = input<string>();

  protected readonly chips = computed<CategoryChip[]>(() => {
    const service = this.catalog.catalog()?.categories.service ?? [];
    const order = service.map(({ id }) => id);
    return categoryCoverage(this.provider(), this.planId(), this.today(), order).flatMap(
      ({ category, inPlan }) => {
        const found = service.find(({ id }) => id === category);
        return found ? [{ id: category, name: found.name, icon: found.icon, inPlan }] : [];
      },
    );
  });
  /** "This plan: VPN and Email. Its other plans: Calendars.", or "Its plans: …" with no plan picked. */
  protected readonly label = computed(() => {
    const chips = this.chips();
    const list = (inPlan: boolean) =>
      names.format(chips.filter((chip) => chip.inPlan === inPlan).map(({ name }) => name));
    if (this.planId() === undefined || chips.every((chip) => !chip.inPlan)) {
      return `Its plans: ${names.format(chips.map(({ name }) => name))}.`;
    }
    return chips.every((chip) => chip.inPlan)
      ? `This plan: ${list(true)}.`
      : `This plan: ${list(true)}. Its other plans: ${list(false)}.`;
  });
}
