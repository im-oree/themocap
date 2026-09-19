import { manifest, type ModelManifestEntry } from '@wms/models';

/** A product pipeline measured end to end, not just per-model. */
export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  /** Model ids, in execution order. */
  modelIds: string[];
  clip: 'live-640x480' | 'refine-1080p';
}

export const FIXTURES: Record<PipelinePreset['clip'], { url: string; label: string }> = {
  'live-640x480': { url: '/fixtures/walk-640x480.mp4', label: '640x480' },
  'refine-1080p': { url: '/fixtures/walk-1080p.mp4', label: '1920x1080' },
};

export const PRESETS: PipelinePreset[] = [
  {
    id: 'live',
    name: 'Live path',
    description: 'detector → 2D pose → 3D lift, combined FPS at 640×480',
    modelIds: ['rtmdet-nano-int8', 'rtmpose-tiny-fp16', 'blazepose-3d-world-fp16'],
    clip: 'live-640x480',
  },
  {
    id: 'live-fp16-det',
    name: 'Live path (fp16 detector)',
    description: 'precision A/B for the detector stage',
    modelIds: ['rtmdet-nano-fp16', 'rtmpose-tiny-fp16', 'blazepose-3d-world-fp16'],
    clip: 'live-640x480',
  },
  {
    id: 'refine',
    name: 'Refine path',
    description: 'strong 2D pose → temporal 3D lift, full resolution',
    modelIds: ['rtmpose-l-fp16', 'motionbert-lite-fp16'],
    clip: 'refine-1080p',
  },
  {
    id: 'refine-vitpose',
    name: 'Refine path (ViTPose-B)',
    description: 'accuracy-ceiling alternative for the refine path',
    modelIds: ['vitpose-b-fp16', 'motionbert-lite-fp16'],
    clip: 'refine-1080p',
  },
  {
    id: 'depth',
    name: 'Depth support',
    description: 'Depth Anything V2 Small, measured standalone',
    modelIds: ['depth-anything-v2-small-fp16'],
    clip: 'refine-1080p',
  },
];

export function resolveModels(ids: string[]): ModelManifestEntry[] {
  return ids.map((id) => {
    const entry = manifest.models.find((m) => m.id === id);
    if (!entry) throw new Error(`Preset references unknown model id "${id}"`);
    return entry;
  });
}

/** Models the operator can run individually. */
export function benchCandidates(): ModelManifestEntry[] {
  return manifest.models.filter((m) => m.stage === 'bench-candidate');
}
