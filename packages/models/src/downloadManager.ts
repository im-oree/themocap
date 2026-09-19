import { verifySha256 } from './checksum';
import type { ModelManifestEntry } from './types';

/**
 * Document 1 scope: fetch a model file from the app's own `/models/` public dir
 * (same-origin, so the offline rule holds) and verify its checksum.
 *
 * Document 3+ replaces the body of `fetchModel` with resumable, range-request
 * downloads into OPFS plus the "Install models" UI. The signature is designed to
 * survive that change, so callers written now don't have to change.
 */

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

export interface FetchModelOptions {
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  /** Skip checksum verification (bench-only escape hatch for local scratch files). */
  skipVerify?: boolean;
}

export function assertSameOrigin(url: string): void {
  if (/^https?:\/\//i.test(url)) {
    throw new Error(`Model URLs must be same-origin or relative; refusing "${url}"`);
  }
}

export async function fetchModel(
  entry: ModelManifestEntry,
  options: FetchModelOptions = {},
): Promise<Uint8Array> {
  assertSameOrigin(entry.file);
  const response = await fetch(entry.file, options.signal ? { signal: options.signal } : undefined);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${entry.id} (${entry.file}): HTTP ${response.status}`);
  }

  const totalHeader = response.headers.get('content-length');
  const totalBytes = totalHeader ? Number(totalHeader) : entry.sizeBytes || null;

  let bytes: Uint8Array;
  if (response.body && options.onProgress) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      options.onProgress({ receivedBytes: received, totalBytes });
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  if (options.skipVerify) return bytes;
  if (!entry.sha256) {
    throw new Error(
      `Model "${entry.id}" has no recorded sha256. Acquire and checksum it first ` +
        '(see docs/decisions.md > Model acquisition), or pass skipVerify for scratch files.',
    );
  }
  await verifySha256(bytes, entry.sha256, entry.id);
  return bytes;
}

/** TODO(Document 3): OPFS-backed cache with resumable range requests. */
export async function isModelCached(_entry: ModelManifestEntry): Promise<boolean> {
  return false;
}
