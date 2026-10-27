import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem } from '@angular/material/menu';
import { Router } from '@angular/router';
import { addRequestParams, type AddRequest, type SubscriptionList } from '@simply-sub/core';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';

/**
 * The Add to list menu (PROJECT-PLAN P7, flows F1 and F4, M5.4): a price opens it after saying what it adds (`add`),
 * and picking a list opens that list's editor with the request in its URL,
 * /lists/<id>/edit?add=<plan id>&interval=<interval>. New list… opens /lists/new with it, where the editor makes a
 * draft list first (M6.3, M6.4). The lists come in the order they were made, each with its number of subscriptions.
 * In Search's pick mode (flow F2, M5.5) there's no menu: a price adds to that mode's list at once.
 */
@Component({
  selector: 'ss-add-to-list-menu',
  imports: [MatDivider, MatIcon, MatMenu, MatMenuItem],
  templateUrl: './add-to-list-menu.html',
  styleUrl: './add-to-list-menu.scss',
})
export class AddToListMenu {
  private readonly router = inject(Router);
  private readonly listsRepository = inject(ListsRepository);
  private readonly items = inject(ItemsRepository);

  /** Pick mode's list (P7, flow F2, M5.5): a price adds to it at once, with no menu. */
  readonly list = input<Pick<SubscriptionList, 'id' | 'name'>>();

  private readonly menu = viewChild.required(MatMenu);
  /** The menu a price opens (its matMenuTriggerFor): none in pick mode. */
  readonly panel = computed(() => (this.list() ? undefined : this.menu()));
  /** What clicking a price does, for screen readers: "add to a list", or "add to Work Related" in pick mode. */
  readonly action = computed(() => {
    const list = this.list();
    return list ? `add to ${list.name}` : 'add to a list';
  });

  /** What the price that opened the menu adds. */
  private readonly request = signal<AddRequest | undefined>(undefined);

  protected readonly lists = computed(() => {
    const counts = new Map<string, number>();
    for (const item of this.items.records()) {
      counts.set(item.listId, (counts.get(item.listId) ?? 0) + 1);
    }
    return this.listsRepository.records().map((list) => {
      const count = counts.get(list.id) ?? 0;
      return {
        id: list.id,
        name: list.name,
        count,
        spoken: count === 1 ? '1 subscription' : `${count} subscriptions`,
      };
    });
  });

  /**
   * What a clicked price adds: in pick mode, straight to its list; otherwise to the list picked in the menu the price
   * opens.
   */
  add(request: AddRequest): void {
    this.request.set(request);
    const list = this.list();
    if (list) this.addTo(list.id);
  }

  protected addTo(listId: string | 'new'): void {
    const request = this.request();
    if (!request) return;
    void this.router.navigate(listId === 'new' ? ['/lists', 'new'] : ['/lists', listId, 'edit'], {
      queryParams: addRequestParams(request),
    });
  }
}
