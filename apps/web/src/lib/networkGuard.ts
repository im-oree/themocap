/**
 * Offline guard. This app must never talk to anything but its own origin.
 *
 * Document 1 installs the mechanism: it patches fetch/XHR and reports any request
 * whose target isn't same-origin (or a blob:/data: URL). With VITE_STRICT_OFFLINE=1
 * it throws instead of warning, which is how CI/Playwright asserts a clean load.
 *
 * Document 3/6 extend this into the full startup check (model cache completeness).
 */

export interface NetworkViolation {
  url: string;
  via: 'fetch' | 'xhr';
  at: number;
}

const violations: NetworkViolation[] = [];
let installed = false;

export function getNetworkViolations(): readonly NetworkViolation[] {
  return violations;
}

export function isAllowedUrl(raw: string, origin: string): boolean {
  if (!raw) return true;
  if (/^(blob:|data:)/i.test(raw)) return true;
  // Relative URLs always resolve to our own origin.
  try {
    const url = new URL(raw, origin);
    if (url.protocol === 'blob:' || url.protocol === 'data:') return true;
    return url.origin === origin;
  } catch {
    // Unparseable => treat as relative => same-origin.
    return true;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export interface NetworkGuardOptions {
  strict?: boolean;
  onViolation?: (v: NetworkViolation) => void;
}

/** Idempotent. Returns an uninstall function. */
export function installNetworkGuard(options: NetworkGuardOptions = {}): () => void {
  if (installed || typeof window === 'undefined') return () => {};
  installed = true;

  const strict = options.strict ?? import.meta.env?.VITE_STRICT_OFFLINE === '1';
  const origin = window.location.origin;

  const report = (url: string, via: NetworkViolation['via']) => {
    const violation: NetworkViolation = { url, via, at: Date.now() };
    violations.push(violation);
    options.onViolation?.(violation);
    const message = `[networkGuard] Blocked non-origin ${via} request: ${url}`;
    if (strict) throw new Error(message);
    console.warn(message);
  };

  const originalFetch = window.fetch.bind(window);
  const originalOpen = XMLHttpRequest.prototype.open;

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isAllowedUrl(url, origin)) report(url, 'fetch');
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;

  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const asString = typeof url === 'string' ? url : url.toString();
    if (!isAllowedUrl(asString, origin)) report(asString, 'xhr');
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  // Expose for Playwright assertions.
  (window as unknown as Record<string, unknown>).__wmsNetworkViolations = violations;

  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    installed = false;
  };
}
