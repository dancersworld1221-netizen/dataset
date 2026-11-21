/** Saves `text` as a file in the browser. Works in Chromium, Firefox and Safari. */
export function downloadFile(filename: string, text: string | Blob, type = "text/plain"): void {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  // Firefox needs the link to be in the document; Safari needs the URL to outlive the click.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies text to the clipboard; resolves false (instead of throwing) when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
