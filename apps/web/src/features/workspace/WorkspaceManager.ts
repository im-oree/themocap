/**
 * Project/take bookkeeping on top of a `WorkspaceProvider`.
 *
 * The provider knows about bytes and paths; this knows about projects, takes, and
 * manifests. Keeping them apart means the layout in `layout.ts` can change without
 * touching three storage backends, and a new backend can be added without knowing
 * what a take is.
 */

import {
  KEYPOINTS_FILE,
  PROJECTS_DIR,
  projectManifestPath,
  slugify,
  takeDir,
  takeIdFor,
  takeKeypointsPath,
  takeManifestPath,
  takesDir,
  takeVideoPath,
  uniqueSlug,
  VIDEO_FILE,
  WORKSPACE_FILE,
  WORKSPACE_VERSION,
  type ProjectManifest,
  type TakeManifest,
  type WorkspaceManifest,
} from './layout';
import { WorkspaceError, type WorkspaceProvider } from './types';

/**
 * `WMOC` v1 magic, little-endian, matching `MAGIC` in crates/mocap-core's
 * pose_format.rs. Duplicated here (rather than imported from the WASM package)
 * so take validation still works when the WASM module has not been built.
 */
export const WMOC_MAGIC = 0x574d_4f43;
export const WMOC_HEADER_BYTES = 18;

export interface CreateTakeOptions {
  projectId: string;
  name: string;
  now?: Date;
}

export class WorkspaceManager {
  constructor(private readonly provider: WorkspaceProvider) {}

  get storage(): WorkspaceProvider {
    return this.provider;
  }

  /** Creates `workspace.json` and `projects/` if this root is new. Idempotent. */
  async initialize(): Promise<WorkspaceManifest> {
    if (await this.provider.exists(WORKSPACE_FILE)) {
      const manifest = JSON.parse(await this.provider.readText(WORKSPACE_FILE)) as
        | WorkspaceManifest
        | undefined;
      if (!manifest || typeof manifest.version !== 'number') {
        throw new WorkspaceError(`${WORKSPACE_FILE} is present but unreadable`, 'invalid-path');
      }
      if (manifest.version > WORKSPACE_VERSION) {
        // Refuse rather than risk mangling a newer layout we do not understand.
        throw new WorkspaceError(
          `This workspace was created by a newer version of the app (v${manifest.version}).`,
          'unsupported',
        );
      }
      await this.provider.mkdirp(PROJECTS_DIR);
      return manifest;
    }

    const manifest: WorkspaceManifest = {
      version: WORKSPACE_VERSION,
      createdAt: new Date().toISOString(),
      app: 'web-mocap-studio',
    };
    await this.provider.writeText(WORKSPACE_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
    await this.provider.mkdirp(PROJECTS_DIR);
    return manifest;
  }

  async listProjectIds(): Promise<string[]> {
    if (!(await this.provider.exists(PROJECTS_DIR))) return [];
    const entries = await this.provider.list(PROJECTS_DIR);
    return entries.filter((e) => e.kind === 'directory').map((e) => e.name);
  }

  async createProject(name: string): Promise<ProjectManifest> {
    const id = uniqueSlug(slugify(name), await this.listProjectIds());
    const now = new Date().toISOString();
    const manifest: ProjectManifest = {
      version: WORKSPACE_VERSION,
      id,
      name,
      createdAt: now,
      updatedAt: now,
    };
    await this.provider.mkdirp(takesDir(id));
    await this.provider.writeText(
      projectManifestPath(id),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return manifest;
  }

  async readProject(projectId: string): Promise<ProjectManifest> {
    const path = projectManifestPath(projectId);
    if (!(await this.provider.exists(path))) {
      throw new WorkspaceError(`No such project: ${projectId}`, 'not-found');
    }
    return JSON.parse(await this.provider.readText(path)) as ProjectManifest;
  }

  /** Returns the project, creating it if it does not exist. */
  async ensureProject(name: string): Promise<ProjectManifest> {
    const id = slugify(name);
    if (await this.provider.exists(projectManifestPath(id))) return this.readProject(id);
    return this.createProject(name);
  }

  async listTakeIds(projectId: string): Promise<string[]> {
    const dir = takesDir(projectId);
    if (!(await this.provider.exists(dir))) return [];
    const entries = await this.provider.list(dir);
    // Take ids are timestamp-prefixed, so lexical sort is chronological.
    return entries
      .filter((e) => e.kind === 'directory')
      .map((e) => e.name)
      .sort();
  }

  /**
   * Allocates a take directory and returns its id. The manifest is written later,
   * by `finalizeTake`, because most of its fields are not known until the
   * recording stops.
   */
  async createTake(options: CreateTakeOptions): Promise<string> {
    const { projectId, name } = options;
    if (!(await this.provider.exists(projectManifestPath(projectId)))) {
      throw new WorkspaceError(`No such project: ${projectId}`, 'not-found');
    }
    const base = takeIdFor(options.now ?? new Date(), name);
    const id = uniqueSlug(base, await this.listTakeIds(projectId));
    await this.provider.mkdirp(takeDir(projectId, id));
    return id;
  }

  /** Writes `take.json`. Call once the recording has stopped and files are closed. */
  async finalizeTake(manifest: TakeManifest): Promise<void> {
    await this.provider.writeText(
      takeManifestPath(manifest.projectId, manifest.id),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  async readTake(projectId: string, takeId: string): Promise<TakeManifest> {
    const path = takeManifestPath(projectId, takeId);
    if (!(await this.provider.exists(path))) {
      throw new WorkspaceError(`No such take: ${projectId}/${takeId}`, 'not-found');
    }
    return JSON.parse(await this.provider.readText(path)) as TakeManifest;
  }

  async readTakeKeypoints(projectId: string, takeId: string): Promise<Uint8Array> {
    return this.provider.readFile(takeKeypointsPath(projectId, takeId));
  }

  /** Opens a streaming writer for the take's video. */
  createVideoWriter(projectId: string, takeId: string) {
    return this.provider.createWriter(takeVideoPath(projectId, takeId));
  }

  /** Opens a streaming writer for the take's pose stream. */
  createKeypointsWriter(projectId: string, takeId: string) {
    return this.provider.createWriter(takeKeypointsPath(projectId, takeId));
  }

  /** Deletes a take and everything in it. */
  async deleteTake(projectId: string, takeId: string): Promise<void> {
    await this.provider.remove(takeDir(projectId, takeId));
  }

  /**
   * Checks a take is complete and readable — the §17 round-trip assertion.
   *
   * Returns the problems found rather than throwing, so the UI can show a partial
   * take as "damaged" instead of failing to list it at all.
   */
  async validateTake(projectId: string, takeId: string): Promise<string[]> {
    const problems: string[] = [];
    const dir = takeDir(projectId, takeId);

    if (!(await this.provider.exists(`${dir}/take.json`))) {
      problems.push('take.json is missing');
      return problems;
    }

    let manifest: TakeManifest;
    try {
      manifest = await this.readTake(projectId, takeId);
    } catch (cause) {
      problems.push(`take.json is not valid JSON: ${String(cause)}`);
      return problems;
    }

    if (manifest.id !== takeId) problems.push(`take.json id "${manifest.id}" != folder "${takeId}"`);
    if (manifest.projectId !== projectId) problems.push('take.json projectId does not match');
    if (!(manifest.frameCount > 0)) problems.push('frameCount is not positive');
    if (!(manifest.durationSeconds > 0)) problems.push('durationSeconds is not positive');

    if (manifest.files.video && !(await this.provider.exists(`${dir}/${VIDEO_FILE}`))) {
      problems.push('video file referenced by take.json is missing');
    }
    if (manifest.files.keypoints) {
      if (!(await this.provider.exists(`${dir}/${KEYPOINTS_FILE}`))) {
        problems.push('keypoints file referenced by take.json is missing');
      } else {
        const bytes = await this.readTakeKeypoints(projectId, takeId);
        if (bytes.byteLength < WMOC_HEADER_BYTES) {
          problems.push('keypoints file is shorter than a WMOC header');
        } else {
          const magic = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
          if (magic !== WMOC_MAGIC) problems.push('keypoints file has a bad WMOC magic');
        }
      }
    }
    return problems;
  }
}
