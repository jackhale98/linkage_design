// Browser file helpers: download text, pick a file, read it.

export function downloadText(fileName: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept = '.csv,text/csv'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** Largest file we try to open; project files are a few KB. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function readText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`File is too large (${(file.size / 1e6).toFixed(1)} MB)`);
  return file.text();
}
