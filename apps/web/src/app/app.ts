import { Component } from '@angular/core';
import { Shell } from './layout/shell';

@Component({
  selector: 'ss-root',
  imports: [Shell],
  template: '<ss-shell />',
})
export class App {}
