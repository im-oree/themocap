/**
 * User-installed model files (Document 3 §C: "Install models").
 *
 * The app ships with no real weights: they are large and their licences differ
 * per model, so they are not committed. This is how a user supplies their own —
 * pick an `.onnx` from disk once, and it is kept in OPFS so it survives reloads
 * and stays available offline, which is the whole point of the project.
 *
 * Stored under a dedicated `models/` directory in the origin's private file
 * system, deliberately *not* in the user's workspace folder: a model is a
 * property of this browser's installation, not of a project, and copying a
 * 9 MB file into every workspace would be wasteful and confusing.
 */

import { sha256Hex } from '@wms/models';

const MODELS_DIR = 'models';

export interface InstalledModel {
  /** Filename as stored, e.g. `movenet-singlepose-lightning.onnx`. */
  name: string;
  sizeBytes: number;
  sha256: string;
  installedAt: string;
}

interface InstalledIndex {
  version: 1;
  models: InstalledModel[];
}

const INDEX_FILE = 'installed.json';

function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
}

async function modelsDir(): Promise<FileSystemDirectoryHandle> {
  if (!opfsAvailable()) throw new Error('This browser has no private file system for models.');
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MODELS_DIR, { create: true });
}

async function readIndex(): Promise<InstalledIndex> {
  try {
    const dir = await modelsDir();
    const handle = await dir.getFileHandle(INDEX_FILE);
    const text = await (await handle.getFile()).text();
    const parsed = JSON.parse(text) as InstalledIndex;
    return parsed.version === 1 && Array.isArray(parsed.models)
      ? parsed
      : { version: 1, models: [] };
  } catch {
    // Absent or corrupt index: treat as empty rather than failing. The files
    // themselves are the source of truth; the index is a convenience.
    return { version: 1, models: [] };
  }
}

async function writeIndex(index: InstalledIndex): Promise<void> {
  const dir = await modelsDir();
  const handle = await dir.getFileHandle(INDEX_FILE, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(index, null, 2));
  await writable.close();
}

export async function listInstalledModels(): Promise<InstalledModel[]> {
  if (!opfsAvailable()) return [];
  return (await readIndex()).models;
}

/** ONNX files begin with a protobuf field tag; used as a cheap sanity check. */
function looksLikeOnnx(bytes: Uint8Array): boolean {
  // Field 1 (ir_version), varint -> first byte 0x08. Every ONNX model written
  // by a standard exporter starts this way. Not a guarantee, but it rejects the
  // common mistakes (a .zip, an HTML error page, a Git LFS pointer) immediately
  // instead of failing later inside the runtime with an opaque message.
  return bytes.length > 8 && bytes[0] === 0x08;
}

export class ModelInstallError extends Error {}

/**
 * Installs a user-selected `.onnx`, returning its recorded metadata.
 *
 * The checksum is computed here and kept, so a later load can prove the file
 * has not changed — the same guarantee the shipped manifest provides for
 * bundled models.
 */
export async function installModel(file: File): Promise<InstalledModel> {
  if (!/\.onnx$/i.test(file.name)) {
    throw new ModelInstallError(`"${file.name}" is not an .onnx file.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeOnnx(bytes)) {
    throw new ModelInstallError(
      `"${file.name}" does not look like an ONNX model. If it came from GitHub, ` +
        'check it is the real file and not a Git LFS pointer.',
    );
  }

  const dir = await modelsDir();
  const handle = await dir.getFileHandle(file.name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();

  const record: InstalledModel = {
    name: file.name,
    sizeBytes: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    installedAt: new Date().toISOString(),
  };

  const index = await readIndex();
  // Re-installing the same filename replaces it rather than duplicating.
  index.models = [...index.models.filter((m) => m.name !== record.name), record];
  await writeIndex(index);
  return record;
}

export async function removeInstalledModel(name: string): Promise<void> {
  const dir = await modelsDir();
  await dir.removeEntry(name).catch(() => undefined);
  const index = await readIndex();
  index.models = index.models.filter((m) => m.name !== name);
  await writeIndex(index);
}

/**
 * Reads an installed model back as bytes.
 *
 * Verifies the recorded checksum: a file that changed under us must not be
 * silently loaded, since it is about to drive every recording the user makes.
 */
export async function readInstalledModel(name: string): Promise<Uint8Array> {
  const index = await readIndex();
  const record = index.models.find((m) => m.name === name);
  if (!record) throw new ModelInstallError(`Model "${name}" is not installed.`);

  const dir = await modelsDir();
  const handle = await dir.getFileHandle(name);
  const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());

  const actual = await sha256Hex(bytes);
  if (actual !== record.sha256) {
    throw new ModelInstallError(
      `Installed model "${name}" failed its checksum. Re-install it.`,
    );
  }
  return bytes;
}

/** Object URL for an installed model, for handing to the ONNX runtime. */
export async function installedModelUrl(name: string): Promise<string> {
  const bytes = await readInstalledModel(name);
  return URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }));
}
