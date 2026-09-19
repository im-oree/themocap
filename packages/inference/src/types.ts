/**
 * Inference contracts. Every consumer (app, workers, tools/bench) codes against
 * these types — nothing outside `ortWebBackend.ts` may import onnxruntime-web.
 */

export type BackendId = 'ort-web-wasm' | 'ort-web-webgpu';

export type Precision = 'fp32' | 'fp16' | 'int8';

export type TensorDataType = 'float32' | 'int64' | 'uint8';

export interface TensorView {
  data: Float32Array | Int32Array | BigInt64Array | Uint8Array;
  dims: readonly number[];
  type: TensorDataType;
}

/** Static description of a model artifact the runtime can load. */
export interface ModelSpec {
  /** Stable id, e.g. "rtmpose-tiny". */
  id: string;
  /** Same-origin URL or OPFS path. Never a CDN URL. */
  url: string;
  /** Lowercase hex sha256 of the file. */
  sha256: string;
  sizeBytes: number;
  precision: Precision;
  /** Expected input tensor shape, e.g. [1, 3, 256, 192]. */
  inputShape: readonly number[];
  inputName: string;
  outputNames: readonly string[];
}

export interface SessionOptions {
  /** Override thread count; defaults to the capability-derived value. */
  numThreads?: number;
  graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
  freeDimensionOverrides?: Record<string, number>;
}

export interface ModelHandle {
  readonly id: string;
  readonly backend: BackendId;
  /** Milliseconds from fetch start through session creation. */
  readonly loadTimeMs: number;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, TensorView>): Promise<Record<string, TensorView>>;
  dispose(): Promise<void>;
}

export interface InferenceBackend {
  readonly id: BackendId;
  /** Resolves false when the environment can't support this backend. */
  isAvailable(): Promise<boolean>;
  /** Idempotent one-time runtime configuration (wasm paths, threads, ...). */
  init(): Promise<void>;
  load(spec: ModelSpec, options?: SessionOptions): Promise<ModelHandle>;
}

export interface Capabilities {
  simd: boolean;
  threads: boolean;
  crossOriginIsolated: boolean;
  webgpu: boolean;
  hardwareConcurrency: number;
  /** Heuristic upper bound for a single allocation. */
  maxBufferBytes: number;
  deviceMemoryGb: number | null;
}
