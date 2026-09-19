import type { Precision } from '@wms/inference/types';

export type ModelTask = 'person-detector' | 'pose-2d' | 'lift-3d' | 'depth';

export type ModelStage =
  'bench-candidate' | 'selected-live' | 'selected-refine' | 'rejected' | 'deferred';

/** Where the artifact came from, so any file can be re-derived from scratch. */
export interface ModelProvenance {
  /** Upstream project, e.g. "open-mmlab/mmpose". */
  repo: string;
  /** Commit/tag the weights or export script came from. */
  ref: string;
  /** Human-readable page describing the checkpoint (docs-only field). */
  sourceUrl: string;
  /** How the ONNX was produced: "published" or the export command used. */
  exportMethod: string;
  license: string;
  licenseUrl: string;
  /** True only after a human has read the actual license text. */
  licenseVerified: boolean;
}

export interface ModelManifestEntry {
  id: string;
  displayName: string;
  task: ModelTask;
  stage: ModelStage;
  precision: Precision;
  /** Path served same-origin from the app's public dir, or an OPFS key. */
  file: string;
  /**
   * True once the ONNX file has actually been fetched, checksummed and committed
   * to the local model store. Entries may exist before acquisition so the bench
   * UI can list what still needs to be obtained.
   */
  acquired: boolean;
  /** Lowercase hex sha256 — required once `acquired` is true, otherwise null. */
  sha256: string | null;
  /** Byte size — required once `acquired` is true, otherwise null. */
  sizeBytes: number | null;
  inputName: string;
  inputShape: number[];
  outputNames: string[];
  /** Normalization/letterbox notes needed to preprocess correctly. */
  preprocessing?: {
    mean?: [number, number, number];
    std?: [number, number, number];
    layout: 'nchw' | 'nhwc';
    colorOrder: 'rgb' | 'bgr';
    letterbox: boolean;
  };
  provenance: ModelProvenance;
  notes?: string;
}

export interface ModelManifest {
  schemaVersion: 1;
  updated: string;
  models: ModelManifestEntry[];
}

export class ManifestValidationError extends Error {}

const TASKS: ModelTask[] = ['person-detector', 'pose-2d', 'lift-3d', 'depth'];
const STAGES: ModelStage[] = [
  'bench-candidate',
  'selected-live',
  'selected-refine',
  'rejected',
  'deferred',
];
const PRECISIONS: Precision[] = ['fp32', 'fp16', 'int8'];

/** Runtime validation — the manifest is data, so it gets checked like data. */
export function validateManifest(input: unknown): ModelManifest {
  const m = input as ModelManifest;
  if (!m || typeof m !== 'object') throw new ManifestValidationError('manifest must be an object');
  if (m.schemaVersion !== 1) throw new ManifestValidationError('unsupported schemaVersion');
  if (!Array.isArray(m.models)) throw new ManifestValidationError('models must be an array');

  const seen = new Set<string>();
  for (const entry of m.models) {
    const where = `model "${entry?.id ?? '<missing id>'}"`;
    if (!entry.id) throw new ManifestValidationError('every model needs an id');
    if (seen.has(entry.id)) throw new ManifestValidationError(`duplicate id: ${entry.id}`);
    seen.add(entry.id);
    if (!TASKS.includes(entry.task)) throw new ManifestValidationError(`${where}: bad task`);
    if (!STAGES.includes(entry.stage)) throw new ManifestValidationError(`${where}: bad stage`);
    if (!PRECISIONS.includes(entry.precision))
      throw new ManifestValidationError(`${where}: bad precision`);
    if (typeof entry.acquired !== 'boolean')
      throw new ManifestValidationError(`${where}: acquired must be a boolean`);
    if (entry.acquired) {
      if (!entry.sha256 || !/^[0-9a-f]{64}$/.test(entry.sha256))
        throw new ManifestValidationError(`${where}: acquired models need a 64-hex sha256`);
      if (!Number.isInteger(entry.sizeBytes) || (entry.sizeBytes ?? 0) <= 0)
        throw new ManifestValidationError(`${where}: acquired models need a positive sizeBytes`);
    } else {
      if (entry.sha256 !== null)
        throw new ManifestValidationError(`${where}: sha256 must be null until acquired`);
      if (entry.sizeBytes !== null)
        throw new ManifestValidationError(`${where}: sizeBytes must be null until acquired`);
    }
    if (/^https?:\/\//i.test(entry.file))
      throw new ManifestValidationError(`${where}: file must be same-origin, got ${entry.file}`);
    if (!Array.isArray(entry.inputShape) || entry.inputShape.length === 0)
      throw new ManifestValidationError(`${where}: inputShape required`);
    if (!entry.provenance?.licenseVerified)
      throw new ManifestValidationError(`${where}: license must be human-verified`);
  }
  return m;
}

export function modelsByStage(manifest: ModelManifest, stage: ModelStage): ModelManifestEntry[] {
  return manifest.models.filter((m) => m.stage === stage);
}
