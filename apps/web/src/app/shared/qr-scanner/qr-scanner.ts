import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';

/** The largest square the scanner reads, in pixels: a QR code on a phone's screen reads well at it, and fast. */
const frameSize = 640;
/** How often it reads a frame, in milliseconds. */
const frameMs = 150;

/**
 * Scans a QR code with the device's camera (PROJECT-PLAN M10.14): Join's way to read the code on another device's
 * screen, which works in a Home Screen web app, where a phone's own camera app can't hand a link to. Every 150 ms it
 * reads the square in the middle of the camera's frame, as the viewfinder shows it, with `@paulmillr/qr`'s decoder
 * (loaded only then) and emits each code's text; nothing leaves the device. The camera stops when it's closed. Without
 * a camera, or the user's leave, it says so in words. It takes the place of the button that opens it, so focus moves
 * to its Stop scanning.
 */
@Component({
  selector: 'ss-qr-scanner',
  imports: [MatButton],
  templateUrl: './qr-scanner.html',
  styleUrl: './qr-scanner.scss',
})
export class QrScanner {
  private readonly document = inject(DOCUMENT);
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly stopButton = viewChild.required<MatButton, ElementRef<HTMLElement>>('stop', {
    read: ElementRef,
  });

  /** The text of each QR code read, until it's closed. */
  readonly scanned = output<string>();
  /** Stop scanning was pressed. */
  readonly closed = output<void>();

  protected readonly status = signal('Starting the camera…');
  /** The camera is showing. */
  protected readonly showing = signal(false);
  private stream?: MediaStream;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor() {
    afterNextRender(() => {
      this.stopButton().nativeElement.focus();
      void this.start();
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private async start(): Promise<void> {
    const media = this.document.defaultView?.navigator.mediaDevices;
    if (!media?.getUserMedia) {
      this.status.set('This browser can’t use a camera here: type the words instead.');
      return;
    }
    try {
      const [{ decodeQR }, stream] = await Promise.all([
        import('@paulmillr/qr/decode.js'),
        media.getUserMedia({ video: { facingMode: 'environment' }, audio: false }),
      ]);
      if (this.stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      const video = this.video().nativeElement;
      video.srcObject = stream;
      await video.play();
      this.showing.set(true);
      this.status.set('Point the camera at the QR code on your other device.');
      this.read(decodeQR);
    } catch (error) {
      if (this.stopped) return;
      const name = error instanceof DOMException ? error.name : '';
      this.status.set(
        name === 'NotAllowedError'
          ? 'Simply Sub isn’t allowed to use the camera: allow it in the browser’s settings, or type the words instead.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'This device has no camera to scan with: type the words instead.'
            : 'The camera couldn’t start: type the words instead.',
      );
    }
  }

  /** Reads a frame, and the next one in a moment, until it's stopped. */
  private read(decode: typeof import('@paulmillr/qr/decode.js').decodeQR): void {
    const canvas = this.document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const frame = () => {
      if (this.stopped || !context) return;
      const video = this.video().nativeElement;
      const side = Math.min(video.videoWidth, video.videoHeight);
      if (side > 0) {
        // The square in the middle, which the viewfinder shows.
        const size = Math.min(side, frameSize);
        canvas.width = size;
        canvas.height = size;
        context.drawImage(
          video,
          (video.videoWidth - side) / 2,
          (video.videoHeight - side) / 2,
          side,
          side,
          0,
          0,
          size,
          size,
        );
        const image = context.getImageData(0, 0, size, size);
        let text: string | undefined;
        try {
          text = decode({ width: image.width, height: image.height, data: image.data });
        } catch {
          // No QR code in this frame.
        }
        if (text !== undefined) this.scanned.emit(text);
      }
      this.timer = setTimeout(frame, frameMs);
    };
    frame();
  }

  private stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
  }
}
