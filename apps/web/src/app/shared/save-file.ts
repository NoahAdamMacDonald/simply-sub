/**
 * Saves `content` as a file the browser downloads, named `name`: a Blob URL on a link that's clicked, then let go. No
 * markup is written, so the strict CSP and Trusted Types allow it (BLUEPRINT §11.5). The backup's text, or an
 * export's text or bytes (M7.5).
 */
export function saveFile(document: Document, name: string, content: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // A moment later: some browsers start the download only after the click has run.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
