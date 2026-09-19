/**
 * Capability detection and provider selection.
 *
 * Policy, in one place:
 *
 * 1. Detect which tiers this browser supports.
 * 2. Prefer `fsa` > `opfs` > `idb-fallback`.
 * 3. Honour a user override if the chosen tier is actually supported, otherwise
 *    fall back to the preferred tier and say so.
 *
 * Point 3 is why this returns a `reason`: silently ignoring a stored preference
 * (because the user switched from Chrome to Safari) would leave them staring at a
 * badge that says "Browser database" with no explanation.
 */

import { FsaWorkspaceProvider, isFsaSupported } from './providers/fsaProvider';
import { IdbWorkspaceProvider, isIdbSupported } from './providers/idbProvider';
import { isOpfsSupported, OpfsWorkspaceProvider } from './providers/opfsProvider';
import {
  WorkspaceError,
  type WorkspaceCapabilities,
  type WorkspaceProvider,
  type WorkspaceProviderId,
} from './types';

/** Best-first preference order. */
export const PROVIDER_PRIORITY: WorkspaceProviderId[] = ['fsa', 'opfs', 'idb-fallback'];

/** Short human-facing descriptions, used by the picker UI. */
export const PROVIDER_INFO: Record<
  WorkspaceProviderId,
  { title: string; detail: string; caveat: string }
> = {
  fsa: {
    title: 'Folder on your computer',
    detail: 'Recordings are saved into a folder you choose, visible in your file browser.',
    caveat: 'Chromium-based browsers only. You will be asked to pick a folder.',
  },
  opfs: {
    title: 'Browser storage',
    detail: 'Fast private storage managed by the browser. No folder picker needed.',
    caveat: 'Files are not visible outside the app, and clearing site data deletes them.',
  },
  'idb-fallback': {
    title: 'Browser database',
    detail: 'Works everywhere. Used when nothing better is available.',
    caveat: 'Recordings are held in memory before being saved, so long takes may fail.',
  },
};

export function detectWorkspaceCapabilities(): WorkspaceCapabilities {
  const available: WorkspaceProviderId[] = [];
  if (isFsaSupported()) available.push('fsa');
  if (isOpfsSupported()) available.push('opfs');
  if (isIdbSupported()) available.push('idb-fallback');

  const preferred = PROVIDER_PRIORITY.find((id) => available.includes(id));
  if (!preferred) {
    // No persistent storage at all: private-mode Firefox with IDB disabled, say.
    return { available, preferred: 'idb-fallback', requiresUserGesture: false };
  }
  return {
    available,
    preferred,
    requiresUserGesture: preferred === 'fsa',
  };
}

export function createProvider(id: WorkspaceProviderId): WorkspaceProvider {
  switch (id) {
    case 'fsa':
      return new FsaWorkspaceProvider();
    case 'opfs':
      return new OpfsWorkspaceProvider();
    case 'idb-fallback':
      return new IdbWorkspaceProvider();
    default: {
      const exhaustive: never = id;
      throw new WorkspaceError(`Unknown workspace provider: ${String(exhaustive)}`, 'unsupported');
    }
  }
}

export interface ProviderSelection {
  provider: WorkspaceProvider;
  id: WorkspaceProviderId;
  capabilities: WorkspaceCapabilities;
  /** Why this tier, phrased for the user. */
  reason: 'user-override' | 'auto' | 'override-unavailable' | 'none-available';
}

/**
 * Chooses a provider, respecting a stored override when it is usable.
 *
 * Does not call `requestAccess()` — `fsa` needs a user gesture and the caller
 * owns that. Check `provider.isReady()` before writing.
 */
export function selectProvider(override?: WorkspaceProviderId | null): ProviderSelection {
  const capabilities = detectWorkspaceCapabilities();

  if (capabilities.available.length === 0) {
    return {
      provider: createProvider('idb-fallback'),
      id: 'idb-fallback',
      capabilities,
      reason: 'none-available',
    };
  }

  if (override) {
    if (capabilities.available.includes(override)) {
      return {
        provider: createProvider(override),
        id: override,
        capabilities,
        reason: 'user-override',
      };
    }
    return {
      provider: createProvider(capabilities.preferred),
      id: capabilities.preferred,
      capabilities,
      reason: 'override-unavailable',
    };
  }

  return {
    provider: createProvider(capabilities.preferred),
    id: capabilities.preferred,
    capabilities,
    reason: 'auto',
  };
}

/** One-line explanation for the workspace badge tooltip. */
export function describeSelection(selection: ProviderSelection): string {
  const info = PROVIDER_INFO[selection.id];
  switch (selection.reason) {
    case 'user-override':
      return `${info.title} (your choice). ${info.caveat}`;
    case 'override-unavailable':
      return `Your preferred storage is not supported in this browser, so ${info.title.toLowerCase()} is being used. ${info.caveat}`;
    case 'none-available':
      return 'No persistent storage is available in this browser. Recordings cannot be saved.';
    case 'auto':
    default:
      return `${info.title}. ${info.caveat}`;
  }
}
