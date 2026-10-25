import { Service } from '@angular/core';
import { RecordRepository } from './record-repository';

/** Subscription lists (BLUEPRINT §4.6). Deleting one leaves its items to the caller (P5). */
@Service()
export class ListsRepository extends RecordRepository<'lists'> {
  constructor() {
    super('lists');
  }
}
