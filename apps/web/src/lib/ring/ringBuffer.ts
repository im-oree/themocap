/**
 * Lock-free single-producer / single-consumer ring buffers over SharedArrayBuffer.
 *
 * Three of these carry the whole live pipeline: camera frames (capture worker ->
 * inference worker), poses (inference -> compute), and rig transforms (compute ->
 * main thread renderer). They exist so the 60 fps render loop never blocks on a
 * ~10 fps inference step.
 *
 * # Why dropping is correct
 *
 * There is exactly one writer and one reader per ring, and the writer NEVER waits.
 * If the reader falls behind, the writer laps it and old slots are overwritten.
 * For live preview that is the right trade: a stale frame is worthless, and
 * backpressure on the camera would stall capture and desynchronise the clock.
 * Recording does not use this path — it consumes the encoder stream and the pose
 * writer directly, so nothing user-visible is lost by dropping here.
 *
 * # Correctness argument (the seqlock)
 *
 * A naive "write slot, then publish index" scheme has a tear window: a reader can
 * begin reading slot N while the writer, having lapped, is rewriting slot N. With
 * only 3-6 slots and a fast reader that is rare but not impossible.
 *
 * Each slot therefore carries a **sequence number** and we use the standard
 * seqlock protocol:
 *
 * - Writer: `seq++` (now odd = "write in progress"), write payload, `seq++` (even
 *   again = stable), then publish the slot index.
 * - Reader: read `seq`, bail if odd; copy payload; re-read `seq`; accept the copy
 *   only if the sequence is unchanged. Otherwise the writer touched the slot mid-
 *   read and the copy is garbage, so we report a torn read rather than return it.
 *
 * `Atomics.store` / `Atomics.load` provide the ordering that makes this sound;
 * plain array writes around them would be free to be reordered.
 */

/** Header slot indices. The header is a 4-lane Int32Array shared with the writer. */
export const HEADER = {
  /** Slot index most recently *completed* by the writer. -1 before the first write. */
  WRITE_INDEX: 0,
  /** Total slots in the ring. Written once at construction. */
  SLOT_COUNT: 1,
  /** Monotonic frame counter of the latest completed write. */
  FRAME_INDEX: 2,
  /** Reserved for a future drop counter / flags lane. Keeps the header 16-byte aligned. */
  RESERVED: 3,
} as const;

export const HEADER_LANES = 4;

/** Per-slot metadata lanes, stored in their own Int32Array parallel to the payload. */
export const SLOT_META = {
  /** Seqlock counter. Odd = write in progress. */
  SEQ: 0,
  /** Frame index this slot holds. */
  FRAME_INDEX: 1,
  /** Payload length actually written, in elements (<= slot capacity). */
  LENGTH: 2,
  /** Reserved. */
  RESERVED: 3,
} as const;

export const SLOT_META_LANES = 4;

export interface RingLayout {
  /** Number of slots. */
  slotCount: number;
  /** Capacity of one slot, in payload elements (not bytes). */
  slotCapacity: number;
}

/** The three SharedArrayBuffers that constitute a ring. Transferable to workers. */
export interface RingBuffers {
  header: SharedArrayBuffer;
  meta: SharedArrayBuffer;
  payload: SharedArrayBuffer;
  layout: RingLayout;
}

/**
 * Allocates the shared memory for a ring.
 *
 * `bytesPerElement` must match the view the writer and reader will use (1 for
 * Uint8, 4 for Float32/Int32). Mismatched views across threads are the classic
 * SAB bug, so both sides derive their views from this one descriptor.
 */
export function allocateRing(
  slotCount: number,
  slotCapacity: number,
  bytesPerElement: number,
): RingBuffers {
  if (!Number.isInteger(slotCount) || slotCount < 2) {
    throw new RangeError(`allocateRing: slotCount must be an integer >= 2, got ${slotCount}`);
  }
  if (!Number.isInteger(slotCapacity) || slotCapacity < 1) {
    throw new RangeError(
      `allocateRing: slotCapacity must be a positive integer, got ${slotCapacity}`,
    );
  }
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error(
      'SharedArrayBuffer is unavailable — the page is not cross-origin isolated. ' +
        'Check that COOP/COEP headers are being served (see docs/decisions.md).',
    );
  }

  const header = new SharedArrayBuffer(HEADER_LANES * 4);
  const meta = new SharedArrayBuffer(slotCount * SLOT_META_LANES * 4);
  const payload = new SharedArrayBuffer(slotCount * slotCapacity * bytesPerElement);

  const headerView = new Int32Array(header);
  Atomics.store(headerView, HEADER.WRITE_INDEX, -1);
  Atomics.store(headerView, HEADER.SLOT_COUNT, slotCount);
  Atomics.store(headerView, HEADER.FRAME_INDEX, -1);
  Atomics.store(headerView, HEADER.RESERVED, 0);

  return { header, meta, payload, layout: { slotCount, slotCapacity } };
}

/** Result of a read attempt. */
export type ReadResult<T> =
  | { status: 'ok'; frameIndex: number; data: T; length: number }
  | { status: 'empty' }
  | { status: 'torn' };

/**
 * Writer half of a ring. One per ring, on one thread only — constructing two
 * writers for the same buffers breaks the single-producer assumption the seqlock
 * relies on and will corrupt data.
 */
export class RingWriter<T extends Uint8Array | Float32Array | Int32Array> {
  private readonly header: Int32Array;
  private readonly meta: Int32Array;
  private readonly slots: T[];
  private readonly slotCount: number;
  private nextSlot = 0;

  constructor(
    buffers: RingBuffers,
    Ctor: new (buffer: SharedArrayBuffer, byteOffset: number, length: number) => T,
  ) {
    const { slotCount, slotCapacity } = buffers.layout;
    this.header = new Int32Array(buffers.header);
    this.meta = new Int32Array(buffers.meta);
    this.slotCount = slotCount;
    const bpe = (Ctor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    this.slots = Array.from(
      { length: slotCount },
      (_, i) => new Ctor(buffers.payload, i * slotCapacity * bpe, slotCapacity),
    );
  }

  /**
   * Writes one frame and publishes it. Never blocks; laps the reader if needed.
   *
   * `fill` receives the destination slot view and returns how many elements it
   * wrote, so callers can hand over variable-length payloads (a JPEG frame, a
   * pose with a different joint count) without reallocating.
   */
  write(frameIndex: number, fill: (slot: T) => number): void {
    const index = this.nextSlot;
    const base = index * SLOT_META_LANES;

    // Enter the write: make the sequence odd so any concurrent reader bails.
    const seq = Atomics.load(this.meta, base + SLOT_META.SEQ);
    Atomics.store(this.meta, base + SLOT_META.SEQ, seq + 1);

    const slot = this.slots[index]!;
    const length = fill(slot);
    if (length > slot.length) {
      // The payload overran the slot. Close the seqlock before throwing, or the
      // slot stays permanently odd and every future read of it reports 'torn'.
      Atomics.store(this.meta, base + SLOT_META.SEQ, seq + 2);
      throw new RangeError(`RingWriter.write: wrote ${length} elements into a ${slot.length} slot`);
    }
    Atomics.store(this.meta, base + SLOT_META.LENGTH, length);
    Atomics.store(this.meta, base + SLOT_META.FRAME_INDEX, frameIndex);

    // Leave the write: even again, slot is stable.
    Atomics.store(this.meta, base + SLOT_META.SEQ, seq + 2);

    // Publish. Order matters: the slot must be stable before it is advertised.
    Atomics.store(this.header, HEADER.FRAME_INDEX, frameIndex);
    Atomics.store(this.header, HEADER.WRITE_INDEX, index);

    this.nextSlot = (index + 1) % this.slotCount;
  }

  /** Frame index of the most recent completed write, or -1 if none. */
  get latestFrameIndex(): number {
    return Atomics.load(this.header, HEADER.FRAME_INDEX);
  }
}

/**
 * Reader half of a ring. Always reads the *latest* published slot, skipping any
 * frames produced while it was busy — that is the point.
 */
export class RingReader<T extends Uint8Array | Float32Array | Int32Array> {
  private readonly header: Int32Array;
  private readonly meta: Int32Array;
  private readonly slots: T[];
  private lastFrameIndex = -1;

  constructor(
    buffers: RingBuffers,
    Ctor: new (buffer: SharedArrayBuffer, byteOffset: number, length: number) => T,
  ) {
    const { slotCount, slotCapacity } = buffers.layout;
    this.header = new Int32Array(buffers.header);
    this.meta = new Int32Array(buffers.meta);
    const bpe = (Ctor as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    this.slots = Array.from(
      { length: slotCount },
      (_, i) => new Ctor(buffers.payload, i * slotCapacity * bpe, slotCapacity),
    );
  }

  /**
   * Copies the latest published frame into `into` (or a fresh array).
   *
   * Returns `'empty'` if nothing has been published yet, and `'torn'` if the
   * writer overwrote the slot mid-copy. A torn read is not an error — the caller
   * should simply try again next tick, by which point a newer frame exists.
   */
  readLatest(into?: T): ReadResult<T> {
    const index = Atomics.load(this.header, HEADER.WRITE_INDEX);
    if (index < 0) return { status: 'empty' };

    const base = index * SLOT_META_LANES;
    const seqBefore = Atomics.load(this.meta, base + SLOT_META.SEQ);
    if (seqBefore % 2 !== 0) return { status: 'torn' };

    const length = Atomics.load(this.meta, base + SLOT_META.LENGTH);
    const frameIndex = Atomics.load(this.meta, base + SLOT_META.FRAME_INDEX);
    const source = this.slots[index]!;

    // Copy out before re-checking the sequence. Reading straight from the shared
    // slot would hand the caller a view the writer can still mutate.
    let target: T;
    if (into) {
      if (into.length < length) {
        throw new RangeError(
          `RingReader.readLatest: destination holds ${into.length}, frame needs ${length}`,
        );
      }
      into.set(source.subarray(0, length) as never, 0);
      target = into;
    } else {
      target = source.slice(0, length) as T;
    }

    // Re-check: if the sequence moved, the writer was in this slot while we copied.
    const seqAfter = Atomics.load(this.meta, base + SLOT_META.SEQ);
    if (seqAfter !== seqBefore) return { status: 'torn' };

    this.lastFrameIndex = frameIndex;
    return { status: 'ok', frameIndex, data: target, length };
  }

  /**
   * Like `readLatest`, but returns `'empty'` when the latest frame has already
   * been consumed. Use this when repeating work on an unchanged frame is wasteful.
   */
  readIfNewer(into?: T): ReadResult<T> {
    const available = Atomics.load(this.header, HEADER.FRAME_INDEX);
    if (available < 0) return { status: 'empty' };
    if (available <= this.lastFrameIndex) return { status: 'empty' };
    return this.readLatest(into);
  }

  /** Frame index of the last successfully consumed frame, or -1. */
  get consumedFrameIndex(): number {
    return this.lastFrameIndex;
  }

  /** Frame index currently available from the writer, or -1. */
  get availableFrameIndex(): number {
    return Atomics.load(this.header, HEADER.FRAME_INDEX);
  }
}
