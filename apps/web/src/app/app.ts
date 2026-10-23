import { Component } from '@angular/core';
import { Shell } from './layout/shell';

@Component({
  selector: 'ss-root',
  imports: [Shell],
  templateUrl: './app.html',
})
export class App {}
