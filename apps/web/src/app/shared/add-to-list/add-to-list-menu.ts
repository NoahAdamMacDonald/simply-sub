import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem } from '@angular/material/menu';
import { Router } from '@angular/router';
import { addRequestParams, type AddRequest } from '@simply-sub/core';
import { ItemsRepository } from '../../core/storage/items-repository';
import { ListsRepository } from '../../core/storage/lists-repository';

/**
 * The Add to list menu (PROJECT-PLAN P7, flows F1 and F4, M5.4): a price opens it after saying what it adds
 * (`prepare`), and picking a list opens that list's editor with the request in its URL,
 * /lists/<id>/edit?add=<plan id>&interval=<interval>. New list… opens /lists/new with it, where the editor makes a
 * draft list first (M6.3, M6.4). The lists come in the order they were made, each with its number of subscriptions.
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

  /** The menu, for a price's matMenuTriggerFor. */
  readonly menu = viewChild.required(MatMenu);

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

  /** Says what picking a list adds: the price that opens the menu calls it. */
  prepare(request: AddRequest): void {
    this.request.set(request);
  }

  protected addTo(listId: string | 'new'): void {
    const request = this.request();
    if (!request) return;
    void this.router.navigate(listId === 'new' ? ['/lists', 'new'] : ['/lists', listId, 'edit'], {
      queryParams: addRequestParams(request),
    });
  }
}
