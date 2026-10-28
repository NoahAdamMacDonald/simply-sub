import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { ListsRepository } from '../../core/storage/lists-repository';
import { PageHeader } from '../../shared/page-header/page-header';

/** Placeholder: a list's optimizations (PROJECT-PLAN P14) are built in M8.2. Its back button goes to the list. */
@Component({
  selector: 'ss-optimizations-page',
  imports: [PageHeader],
  templateUrl: './optimizations-page.html',
})
export class OptimizationsPage {
  private readonly lists = inject(ListsRepository);
  protected readonly listId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((params) => params.get('listId') ?? '')),
    { initialValue: '' },
  );
  /** The list's name, for its back button. */
  protected readonly listName = computed(
    () => this.lists.byId().get(this.listId())?.name ?? 'List',
  );
}
