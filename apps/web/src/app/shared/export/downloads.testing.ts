import { vi } from 'vitest';

// What save-file downloads, kept for a spec to read: jsdom has neither Blob URLs nor downloads. Restore the link's click
// with vi.restoreAllMocks() after each test.

/** A file a link downloaded: its name and its Blob. */
export interface Download {
  name: string;
  blob: Blob;
}

/** Keeps each file save-file downloads from now on in the array it returns. */
export function captureDownloads(): Download[] {
  const blobs = new Map<string, Blob>();
  const downloads: Download[] = [];
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = () => undefined;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (blob) downloads.push({ name: this.download, blob });
  });
  return downloads;
}

/** The text of a CSV download, after the byte order mark that tells Excel it's UTF-8 (Blob.text() drops it unseen). */
export async function csvText(download: Download): Promise<string> {
  const bytes = new Uint8Array(await download.blob.arrayBuffer());
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) {
    throw new Error('No byte order mark');
  }
  return new TextDecoder().decode(bytes.subarray(3));
}
