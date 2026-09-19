import { describe, expect, it } from 'vitest';

import {
  allocateRing,
  HEADER,
  HEADER_LANES,
  RingReader,
  RingWriter,
  SLOT_META,
  SLOT_META_LANES,
} from '../../src/lib/ring/ringBuffer';

/** Fills a slot with `length` copies of `value`, mimicking a real payload write. */
function filler(value: number, length: number) {
  return (slot: Float32Array) => {
    for (let i = 0; i < length; i += 1) slot[i] = value;
    return length;
  };
}

describe('allocateRing', () => {
  it('sizes the three buffers from the layout', () => {
    const ring = allocateRing(4, 10, Float32Array.BYTES_PER_ELEMENT);
    expect(ring.header.byteLength).toBe(HEADER_LANES * 4);
    expect(ring.meta.byteLength).toBe(4 * SLOT_META_LANES * 4);
    expect(ring.payload.byteLength).toBe(4 * 10 * 4);
    expect(ring.layout).toEqual({ slotCount: 4, slotCapacity: 10 });
  });

  it('starts empty, with slotCount recorded in the header', () => {
    const ring = allocateRing(3, 8, 4);
    const header = new Int32Array(ring.header);
    expect(header[HEADER.WRITE_INDEX]).toBe(-1);
    expect(header[HEADER.FRAME_INDEX]).toBe(-1);
    expect(header[HEADER.SLOT_COUNT]).toBe(3);
  });

  it('rejects degenerate layouts', () => {
    expect(() => allocateRing(1, 8, 4)).toThrow(/slotCount/);
    expect(() => allocateRing(3, 0, 4)).toThrow(/slotCapacity/);
    expect(() => allocateRing(2.5, 8, 4)).toThrow(/slotCount/);
  });
});

describe('RingWriter / RingReader', () => {
  it('reports empty before anything is written', () => {
    const ring = allocateRing(3, 4, 4);
    const reader = new RingReader(ring, Float32Array);
    expect(reader.readLatest().status).toBe('empty');
    expect(reader.availableFrameIndex).toBe(-1);
  });

  it('round-trips a single frame', () => {
    const ring = allocateRing(3, 4, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);

    writer.write(0, (slot) => {
      slot.set([1.5, 2.5, 3.5, 4.5]);
      return 4;
    });

    const result = reader.readLatest();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(Array.from(result.data)).toEqual([1.5, 2.5, 3.5, 4.5]);
    expect(result.frameIndex).toBe(0);
    expect(result.length).toBe(4);
  });

  it('always yields the newest frame, dropping the ones in between', () => {
    const ring = allocateRing(3, 2, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);

    // Reader is "slow": five writes land before it looks.
    for (let f = 0; f < 5; f += 1) writer.write(f, filler(f, 2));

    const result = reader.readLatest();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.frameIndex).toBe(4);
    expect(Array.from(result.data)).toEqual([4, 4]);
  });

  it('cycles through slots and wraps', () => {
    const ring = allocateRing(3, 1, 4);
    const writer = new RingWriter(ring, Float32Array);
    const header = new Int32Array(ring.header);

    const seen: number[] = [];
    for (let f = 0; f < 7; f += 1) {
      writer.write(f, filler(f, 1));
      seen.push(header[HEADER.WRITE_INDEX]!);
    }
    expect(seen).toEqual([0, 1, 2, 0, 1, 2, 0]);
  });

  it('writes into a caller-supplied destination without allocating', () => {
    const ring = allocateRing(3, 4, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);
    const dest = new Float32Array(4);

    writer.write(7, filler(9, 4));
    const result = reader.readLatest(dest);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data).toBe(dest);
    expect(Array.from(dest)).toEqual([9, 9, 9, 9]);
  });

  it('throws when the destination is too small', () => {
    const ring = allocateRing(3, 4, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);
    writer.write(0, filler(1, 4));
    expect(() => reader.readLatest(new Float32Array(2))).toThrow(/destination holds 2/);
  });

  it('handles variable-length payloads', () => {
    const ring = allocateRing(3, 8, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);

    writer.write(0, filler(1, 8));
    writer.write(1, filler(2, 3));

    const result = reader.readLatest();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Only the 3 elements actually written are returned, not the stale tail.
    expect(Array.from(result.data)).toEqual([2, 2, 2]);
  });

  it('closes the seqlock even when the fill callback overruns', () => {
    const ring = allocateRing(3, 2, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);

    writer.write(0, filler(5, 2));
    expect(() => writer.write(1, () => 99)).toThrow(/wrote 99 elements/);

    // A leaked odd sequence would make every later read of slot 1 report 'torn'.
    const meta = new Int32Array(ring.meta);
    expect(meta[1 * SLOT_META_LANES + SLOT_META.SEQ]! % 2).toBe(0);

    writer.write(2, filler(6, 2));
    const result = reader.readLatest();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(Array.from(result.data)).toEqual([6, 6]);
  });
});

describe('seqlock tear detection', () => {
  it('reports torn when the slot is mid-write', () => {
    const ring = allocateRing(3, 2, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);
    writer.write(0, filler(1, 2));

    // Simulate a writer that has entered slot 0 but not yet left it.
    const meta = new Int32Array(ring.meta);
    Atomics.store(meta, SLOT_META.SEQ, Atomics.load(meta, SLOT_META.SEQ) + 1);

    expect(reader.readLatest().status).toBe('torn');
  });

  it('reports torn when the sequence advances during the copy', () => {
    const ring = allocateRing(3, 2, 4);
    const writer = new RingWriter(ring, Float32Array);
    writer.write(0, filler(1, 2));

    const meta = new Int32Array(ring.meta);
    const reader = new RingReader(ring, Float32Array);

    // A destination whose `set` runs writer interference mid-copy — the closest we
    // can get to a real race in a single-threaded test.
    class HostileArray extends Float32Array {
      override set(source: ArrayLike<number>, offset?: number): void {
        Atomics.store(meta, SLOT_META.SEQ, Atomics.load(meta, SLOT_META.SEQ) + 2);
        super.set(source, offset);
      }
    }
    const dest = new HostileArray(2);

    expect(reader.readLatest(dest as unknown as Float32Array<ArrayBuffer>).status).toBe('torn');
  });

  it('does not advance consumedFrameIndex on a torn read', () => {
    const ring = allocateRing(3, 2, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);
    writer.write(0, filler(1, 2));
    expect(reader.readLatest().status).toBe('ok');
    expect(reader.consumedFrameIndex).toBe(0);

    writer.write(1, filler(2, 2));
    const meta = new Int32Array(ring.meta);
    Atomics.store(meta, SLOT_META_LANES + SLOT_META.SEQ, 1);
    expect(reader.readLatest().status).toBe('torn');
    expect(reader.consumedFrameIndex).toBe(0);
  });
});

describe('readIfNewer', () => {
  it('returns a frame once and then reports empty', () => {
    const ring = allocateRing(3, 2, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);

    writer.write(0, filler(1, 2));
    expect(reader.readIfNewer().status).toBe('ok');
    expect(reader.readIfNewer().status).toBe('empty');

    writer.write(1, filler(2, 2));
    const result = reader.readIfNewer();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.frameIndex).toBe(1);
  });

  it('reports empty before the first write', () => {
    const ring = allocateRing(3, 2, 4);
    expect(new RingReader(ring, Float32Array).readIfNewer().status).toBe('empty');
  });
});

describe('frame-counter identity (§17)', () => {
  it('preserves the writer frame index through to the reader over a long run', () => {
    const ring = allocateRing(4, 3, 4);
    const writer = new RingWriter(ring, Float32Array);
    const reader = new RingReader(ring, Float32Array);

    // 300 frames ~ 10s at 30fps. The reader samples at a different rate, so it
    // must see a monotonically increasing subset whose payload always matches the
    // frame index it was tagged with -- no shearing between metadata and payload.
    const received: number[] = [];
    for (let f = 0; f < 300; f += 1) {
      writer.write(f, filler(f, 3));
      if (f % 3 === 0) {
        const result = reader.readIfNewer();
        expect(result.status).toBe('ok');
        if (result.status !== 'ok') continue;
        expect(Array.from(result.data)).toEqual([f, f, f]);
        received.push(result.frameIndex);
      }
    }

    expect(received).toHaveLength(100);
    expect(received[0]).toBe(0);
    expect(received.at(-1)).toBe(297);
    for (let i = 1; i < received.length; i += 1) {
      expect(received[i]!).toBeGreaterThan(received[i - 1]!);
    }
  });
});

describe('typed-array flavours', () => {
  it('works with Uint8Array payloads (camera frames)', () => {
    const ring = allocateRing(3, 16, Uint8Array.BYTES_PER_ELEMENT);
    const writer = new RingWriter(ring, Uint8Array);
    const reader = new RingReader(ring, Uint8Array);

    writer.write(0, (slot) => {
      for (let i = 0; i < 16; i += 1) slot[i] = i * 16;
      return 16;
    });

    const result = reader.readLatest();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data[15]).toBe(240);
    expect(result.data).toBeInstanceOf(Uint8Array);
  });

  it('sizes byte payloads correctly (one byte per element, not four)', () => {
    const ring = allocateRing(3, 16, Uint8Array.BYTES_PER_ELEMENT);
    expect(ring.payload.byteLength).toBe(48);
  });
});
