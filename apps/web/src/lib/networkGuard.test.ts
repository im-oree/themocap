import { describe, expect, it } from 'vitest';
import { isAllowedUrl } from './networkGuard';

const ORIGIN = 'http://localhost:5173';

describe('networkGuard.isAllowedUrl', () => {
  it('allows same-origin, relative, blob and data URLs', () => {
    expect(isAllowedUrl('/models/rtmpose.onnx', ORIGIN)).toBe(true);
    expect(isAllowedUrl('src/main.tsx', ORIGIN)).toBe(true);
    expect(isAllowedUrl(`${ORIGIN}/ort/ort-wasm-simd.wasm`, ORIGIN)).toBe(true);
    expect(isAllowedUrl('blob:http://localhost:5173/abc', ORIGIN)).toBe(true);
    expect(isAllowedUrl('data:text/plain;base64,aGk=', ORIGIN)).toBe(true);
    expect(isAllowedUrl('', ORIGIN)).toBe(true);
  });

  it('blocks CDNs and any other origin', () => {
    expect(isAllowedUrl('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.wasm', ORIGIN)).toBe(
      false,
    );
    expect(isAllowedUrl('https://fonts.googleapis.com/css2?family=Inter', ORIGIN)).toBe(false);
    expect(isAllowedUrl('http://localhost:5174/other', ORIGIN)).toBe(false);
    expect(isAllowedUrl('//evil.example.com/x.js', ORIGIN)).toBe(false);
  });
});
