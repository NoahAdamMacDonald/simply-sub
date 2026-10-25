import { Service } from '@angular/core';
import { RecordRepository } from './record-repository';

/** Services that aren't in the catalog, with their own plans (P12). */
@Service()
export class CustomSubsRepository extends RecordRepository<'customSubs'> {
  constructor() {
    super('customSubs');
  }
}
