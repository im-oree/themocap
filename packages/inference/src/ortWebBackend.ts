import * as ort from 'onnxruntime-web';
import { detectCapabilities, recommendedThreadCount } from './capabilities';
import type {
  BackendId,
  InferenceBackend,
  ModelHandle,
  ModelSpec,
  SessionOptions,
  TensorView,
} from './types';

/**
 * ONNX Runtime Web backend. This is the ONLY module in the repo allowed to import
 * `onnxruntime-web`.
 *
 * Offline rule: wasm binaries are served from the app's own `/ort/` directory
 * (copied out of node_modules at install time by scripts/copy-ort-assets.mjs).
 * ORT's default is a jsDelivr CDN URL — overriding `wasmPaths` is load-bearing.
 */
export const ORT_WASM_PATH = '/ort/';

function toOrtTensor(view: TensorView): ort.Tensor {
  return new ort.Tensor(view.type, view.data as never, view.dims as number[]);
}

function fromOrtTensor(tensor: ort.Tensor): TensorView {
  return {
    data: tensor.data as TensorView['data'],
    dims: tensor.dims,
    type: tensor.type as TensorView['type'],
  };
}

function assertLocalUrl(url: string): void {
  if (/^[a-z]+:\/\//i.test(url) && !url.startsWith(globalThis.location?.origin ?? '\u0000')) {
    throw new Error(
      `Refusing to load model from a non-origin URL: ${url}. Models must be same-origin or OPFS.`,
    );
  }
}

class OrtModelHandle implements ModelHandle {
  constructor(
    readonly id: string,
    readonly backend: BackendId,
    readonly loadTimeMs: number,
    private session: ort.InferenceSession | null,
  ) {}

  get inputNames(): readonly string[] {
    return this.session?.inputNames ?? [];
  }

  get outputNames(): readonly string[] {
    return this.session?.outputNames ?? [];
  }

  async run(feeds: Record<string, TensorView>): Promise<Record<string, TensorView>> {
    if (!this.session) throw new Error(`Model "${this.id}" has been disposed`);
    const ortFeeds: Record<string, ort.Tensor> = {};
    for (const [name, view] of Object.entries(feeds)) ortFeeds[name] = toOrtTensor(view);
    const results = await this.session.run(ortFeeds);
    const out: Record<string, TensorView> = {};
    for (const [name, tensor] of Object.entries(results)) out[name] = fromOrtTensor(tensor);
    return out;
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = null;
  }
}

abstract class OrtWebBackend implements InferenceBackend {
  abstract readonly id: BackendId;
  protected abstract readonly executionProviders: readonly ort.InferenceSession.ExecutionProviderConfig[];

  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    const caps = await detectCapabilities();
    ort.env.wasm.wasmPaths = ORT_WASM_PATH;
    ort.env.wasm.numThreads = recommendedThreadCount(caps);
    // ORT 1.19 always ships SIMD builds; keep the flag explicit for older/newer lines.
    (ort.env.wasm as unknown as { simd?: boolean }).simd = caps.simd;
    ort.env.logLevel = 'warning';
    this.initialized = true;
  }

  abstract isAvailable(): Promise<boolean>;

  async load(spec: ModelSpec, options: SessionOptions = {}): Promise<ModelHandle> {
    assertLocalUrl(spec.url);
    await this.init();
    const started = performance.now();

    const response = await fetch(spec.url);
    if (!response.ok) throw new Error(`Failed to fetch model ${spec.id}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());

    const sessionOptions: ort.InferenceSession.SessionOptions = {
      executionProviders: [...this.executionProviders],
      graphOptimizationLevel: options.graphOptimizationLevel ?? 'all',
    };
    if (options.freeDimensionOverrides) {
      sessionOptions.freeDimensionOverrides = options.freeDimensionOverrides;
    }
    if (options.numThreads !== undefined) {
      ort.env.wasm.numThreads = options.numThreads;
    }

    const session = await ort.InferenceSession.create(bytes, sessionOptions);
    return new OrtModelHandle(spec.id, this.id, performance.now() - started, session);
  }
}

export class OrtWasmBackend extends OrtWebBackend {
  readonly id = 'ort-web-wasm' as const;
  protected readonly executionProviders = ['wasm'] as const;

  async isAvailable(): Promise<boolean> {
    return typeof WebAssembly !== 'undefined';
  }
}

export class OrtWebGpuBackend extends OrtWebBackend {
  readonly id = 'ort-web-webgpu' as const;
  // Falls back to wasm per-kernel; session creation fails loudly if WebGPU is absent.
  protected readonly executionProviders = ['webgpu', 'wasm'] as const;

  async isAvailable(): Promise<boolean> {
    const { detectWebGPU } = await import('./capabilities');
    return detectWebGPU();
  }
}

export function createBackend(id: BackendId): InferenceBackend {
  return id === 'ort-web-webgpu' ? new OrtWebGpuBackend() : new OrtWasmBackend();
}
