import '@testing-library/jest-dom/vitest';

/** Vitest setup: jsdom lacks a few APIs the design system touches. */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * jsdom's Blob predates the `arrayBuffer()`/`text()` methods, and `File` inherits
 * the gap. The workspace providers use both on every read, so without this shim
 * the storage-tier suite cannot run at all. Node's `Blob` is spec-complete, so we
 * borrow its implementations rather than hand-rolling a FileReader dance.
 */
for (const Ctor of [globalThis.Blob, globalThis.File]) {
  if (!Ctor) continue;
  const proto = Ctor.prototype as Blob & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    text?: () => Promise<string>;
  };
  if (typeof proto.arrayBuffer !== 'function') {
    proto.arrayBuffer = function arrayBuffer(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  if (typeof proto.text !== 'function') {
    proto.text = async function text(this: Blob) {
      return new TextDecoder().decode(new Uint8Array(await this.arrayBuffer!()));
    };
  }
}

/**
 * jsdom has no `ResizeObserver`. Both the docking system and the viewport depend
 * on it, so without a stub neither can be mounted in a test at all. This is a
 * no-op recorder rather than a real implementation: jsdom does no layout, so
 * there are no resizes to observe — it exists purely so construction succeeds.
 */
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

/** Likewise absent in jsdom; dockview's floating groups probe for it. */
if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
