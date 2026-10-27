import { Service } from '@angular/core';
import { RecordRepository } from './record-repository';

/**
 * Subscription lists (BLUEPRINT §4.6). `remove` leaves a list's items as they are: Delete list (P5) deletes them with
 * it, and its draft, through DraftsRepository.deleteList.
 */
@Service()
export class ListsRepository extends RecordRepository<'lists'> {
  constructor() {
    super('lists');
  }
}
