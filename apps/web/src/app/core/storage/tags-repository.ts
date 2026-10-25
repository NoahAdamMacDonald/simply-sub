import { Service } from '@angular/core';
import { RecordRepository } from './record-repository';

/** The coloured tags managed in Settings (P13). */
@Service()
export class TagsRepository extends RecordRepository<'tags'> {
  constructor() {
    super('tags');
  }
}
