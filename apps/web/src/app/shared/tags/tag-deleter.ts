import { Service, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { Tag } from '@simply-sub/core';
import { TagsRepository } from '../../core/storage/tags-repository';
import { ConfirmService } from '../confirm/confirm-service';

/**
 * Deletes a tag (P13's ✕, P6's picker): when subscriptions use it, it asks first ("Used by 5 subscriptions"), then the
 * tag is deleted and taken off them in one transaction (TagsRepository.removeWithItems), and a snackbar says so.
 */
@Service()
export class TagDeleter {
  private readonly tags = inject(TagsRepository);
  private readonly confirmer = inject(ConfirmService);
  private readonly snackBar = inject(MatSnackBar);

  /** True once it's deleted; false when the user kept it. */
  async delete(tag: Tag): Promise<boolean> {
    const count = await this.tags.usage(tag.id);
    if (count > 0) {
      const confirmed = await this.confirmer.confirm({
        title: `Delete “${tag.name}”?`,
        message: `Used by ${count === 1 ? '1 subscription' : `${count} subscriptions`}. It comes off them in every list.`,
        confirmText: 'Delete tag',
        danger: true,
      });
      if (!confirmed) return false;
    }
    await this.tags.removeWithItems(tag.id);
    this.snackBar.open(`Deleted ${tag.name}`, undefined, { duration: 5000 });
    return true;
  }
}
