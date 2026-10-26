import { NgOptimizedImage } from '@angular/common';
import { Component, computed, input, linkedSignal, numberAttribute } from '@angular/core';

/** The largest size a catalog icon is shown at: the files are 96 px, for screens with 2× pixels (BLUEPRINT §6.3). */
const largest = 48;

/**
 * A provider's icon, or the first letter of its name when it has none or the file fails to load (a custom
 * subscription whose /icon answered 404). It's decorative: the name is always beside it.
 */
@Component({
  selector: 'ss-provider-icon',
  imports: [NgOptimizedImage],
  templateUrl: './provider-icon.html',
  styleUrl: './provider-icon.scss',
  host: { '[style.--size.px]': 'px()' },
})
export class ProviderIcon {
  /** The icon's URL: a catalog icon (icons/<id>.webp) or a custom subscription's /icon. */
  readonly src = input<string>();
  readonly name = input.required<string>();
  /** In CSS pixels, at most 48. */
  readonly size = input(32, { transform: numberAttribute });

  protected readonly px = computed(() => Math.min(this.size(), largest));
  protected readonly letter = computed(
    () => Array.from(this.name().trim())[0]?.toLocaleUpperCase('en') ?? '?',
  );
  /** The file failed to load; a new src tries again. */
  protected readonly failed = linkedSignal({ source: this.src, computation: () => false });
  protected readonly shown = computed(() => (this.failed() ? undefined : this.src()));
}
