import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { StorageService } from '../core/storage/storage-service';
import { Logo } from './logo';

/**
 * "Your browser is blocking local storage" (PROJECT-PLAN P15): in place of the app when IndexedDB can't be opened
 * (some private browsing modes, or site data blocked). [Continue anyway] keeps everything in memory for this tab.
 */
@Component({
  selector: 'ss-storage-blocked',
  imports: [Logo, MatButton],
  templateUrl: './storage-blocked.html',
  styleUrl: './storage-blocked.scss',
})
export class StorageBlocked {
  private readonly storage = inject(StorageService);

  protected continueAnyway(): void {
    this.storage.useMemory();
  }
}
