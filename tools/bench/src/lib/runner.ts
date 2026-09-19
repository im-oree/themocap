import {
  createBackend,
  type BackendId,
  type ModelHandle,
  type ModelSpec,
  type TensorView,
} from '@wms/inference';
import type { ModelManifestEntry } from '@wms/models';
import { createSyntheticFrameSource, createVideoFrameSource, type FrameSource } from './frames';
import { imageDataToTensor, inputSize, letterboxToCanvas } from './preprocess';
import {
  compareKeypoints,
  readHeapBytes,
  summarize,
  type AgreementStats,
  type FrameStats,
} from './stats';

export interface RunConfig {
  models: ModelManifestEntry[];
  backend: BackendId;
  /** Fixture clip URL, served from tools/bench/public/fixtures. */
  clipUrl: string;
  clipLabel: string;
  /** Repeats of the whole clip; the first is discarded as warm-up. */
  repeats?: number;
  /** Cap on frames per repeat, to keep runs quick. */
  maxFrames?: number;
  onProgress?: (message: string, fraction: number) => void;
}

export interface ModelRunResult {
  modelId: string;
  displayName: string;
  backend: BackendId;
  precision: string;
  loadTimeMs: number;
  stats: FrameStats;
  peakHeapBytes: number | null;
  error?: string;
  /** Sampled outputs used for the WASM/WebGPU agreement check. */
  sampledOutputs?: Float32Array[];
}

export interface RunResult {
  clipLabel: string;
  backend: BackendId;
  startedAt: string;
  perModel: ModelRunResult[];
  /** Combined pipeline throughput: 1 / sum(per-frame cost of each stage). */
  combinedFps: number | null;
  combinedPeakHeapBytes: number | null;
}

const AGREEMENT_SAMPLE_FRAMES = 30;

function toSpec(entry: ModelManifestEntry): ModelSpec {
  return {
    id: entry.id,
    url: entry.file,
    sha256: entry.sha256 ?? '',
    sizeBytes: entry.sizeBytes ?? 0,
    precision: entry.precision,
    inputShape: entry.inputShape,
    inputName: entry.inputName,
    outputNames: entry.outputNames,
  };
}

/** Flattens the first float output to an [x, y, ...] view for agreement diffing. */
function firstFloatOutput(outputs: Record<string, TensorView>): Float32Array | null {
  for (const view of Object.values(outputs)) {
    if (view.data instanceof Float32Array) return view.data;
  }
  return null;
}

async function openFrameSource(
  config: RunConfig,
): Promise<{ source: FrameSource; synthetic: boolean }> {
  try {
    const head = await fetch(config.clipUrl, { method: 'HEAD' });
    if (head.ok) {
      return { source: await createVideoFrameSource(config.clipUrl), synthetic: false };
    }
  } catch {
    /* fall through to synthetic */
  }
  return { source: createSyntheticFrameSource(640, 480, 90), synthetic: true };
}

export async function runBenchmark(config: RunConfig): Promise<RunResult> {
  const repeats = config.repeats ?? 3;
  const backend = createBackend(config.backend);
  const available = await backend.isAvailable();
  if (!available) {
    throw new Error(`Backend ${config.backend} is not available in this browser.`);
  }
  await backend.init();

  const { source } = await openFrameSource(config);
  const frameCount = Math.min(source.frameCount, config.maxFrames ?? 120);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const perModel: ModelRunResult[] = [];

  for (const [modelIndex, entry] of config.models.entries()) {
    config.onProgress?.(`Loading ${entry.displayName}…`, modelIndex / config.models.length);

    let handle: ModelHandle | null = null;
    try {
      handle = await backend.load(toSpec(entry));
    } catch (error) {
      perModel.push({
        modelId: entry.id,
        displayName: entry.displayName,
        backend: config.backend,
        precision: entry.precision,
        loadTimeMs: 0,
        stats: summarize([]),
        peakHeapBytes: null,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const { width, height } = inputSize(entry);
    canvas.width = width;
    canvas.height = height;

    const keptFrameTimes: number[] = [];
    const sampledOutputs: Float32Array[] = [];
    let peakHeap = readHeapBytes();
    let error: string | undefined;

    outer: for (let repeat = 0; repeat < repeats; repeat++) {
      const isWarmup = repeat === 0;
      for (let f = 0; f < frameCount; f++) {
        const image = await source.seekTo(f);
        letterboxToCanvas(image, source.width, source.height, width, height, ctx);
        const tensor = imageDataToTensor(ctx.getImageData(0, 0, width, height), entry);

        const started = performance.now();
        let outputs: Record<string, TensorView>;
        try {
          outputs = await handle.run({ [handle.inputNames[0] ?? entry.inputName]: tensor });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          break outer;
        }
        const elapsed = performance.now() - started;

        if (!isWarmup) {
          keptFrameTimes.push(elapsed);
          if (sampledOutputs.length < AGREEMENT_SAMPLE_FRAMES) {
            const out = firstFloatOutput(outputs);
            if (out) sampledOutputs.push(Float32Array.from(out.subarray(0, 512)));
          }
        }

        const heap = readHeapBytes();
        if (heap !== null && (peakHeap === null || heap > peakHeap)) peakHeap = heap;

        config.onProgress?.(
          `${entry.displayName} · pass ${repeat + 1}/${repeats} · frame ${f + 1}/${frameCount}`,
          (modelIndex + (repeat * frameCount + f) / (repeats * frameCount)) / config.models.length,
        );
      }
    }

    perModel.push({
      modelId: entry.id,
      displayName: entry.displayName,
      backend: config.backend,
      precision: entry.precision,
      loadTimeMs: handle.loadTimeMs,
      stats: summarize(keptFrameTimes),
      peakHeapBytes: peakHeap,
      sampledOutputs,
      ...(error ? { error } : {}),
    });

    await handle.dispose();
  }

  source.dispose();

  const usable = perModel.filter((m) => !m.error && m.stats.frames > 0);
  const combinedFrameMs = usable.reduce((acc, m) => acc + m.stats.totalMs / m.stats.frames, 0);
  const peaks = perModel.map((m) => m.peakHeapBytes).filter((v): v is number => v !== null);

  return {
    clipLabel: config.clipLabel,
    backend: config.backend,
    startedAt: new Date().toISOString(),
    perModel,
    combinedFps:
      usable.length === config.models.length && combinedFrameMs > 0 ? 1000 / combinedFrameMs : null,
    combinedPeakHeapBytes: peaks.length > 0 ? Math.max(...peaks) : null,
  };
}

/** Runs the same config on both providers and diffs the sampled outputs. */
export async function runAgreementCheck(
  config: Omit<RunConfig, 'backend'>,
): Promise<{ wasm: RunResult; webgpu: RunResult; agreement: Record<string, AgreementStats> }> {
  const wasm = await runBenchmark({ ...config, backend: 'ort-web-wasm' });
  const webgpu = await runBenchmark({ ...config, backend: 'ort-web-webgpu' });

  const agreement: Record<string, AgreementStats> = {};
  for (const a of wasm.perModel) {
    const b = webgpu.perModel.find((m) => m.modelId === a.modelId);
    if (!a.sampledOutputs || !b?.sampledOutputs) continue;
    agreement[a.modelId] = compareKeypoints(a.sampledOutputs, b.sampledOutputs);
  }

  return { wasm, webgpu, agreement };
}
