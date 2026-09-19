export * from './types';
export * from './checksum';
export * from './downloadManager';

import manifestJson from '../manifest.json';
import { validateManifest, type ModelManifest } from './types';

/** The manifest, validated at import time so a bad edit fails fast. */
export const manifest: ModelManifest = validateManifest(manifestJson);
