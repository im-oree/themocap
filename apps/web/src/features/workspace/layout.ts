/**
 * The on-disk layout of a workspace.
 *
 * This is a user-visible contract when the `fsa` provider is in use — people will
 * open this folder in Finder, so it has to be legible and stable. It is also the
 * contract Document 3's project browser will read, so the shapes below are
 * versioned rather than ad hoc.
 *
 * ```
 * <workspace root>/
 *   workspace.json                 { version, createdAt }
 *   projects/
 *     <project-id>/
 *       project.json               ProjectManifest
 *       takes/
 *         <take-id>/
 *           take.json              TakeManifest
 *           video.webm             the MediaRecorder output
 *           raw-keypoints.bin      WMOC v1 pose stream
 *           thumbnail.jpg          optional, first good frame
 * ```
 *
 * IDs are slugs, not UUIDs, so the folder names mean something when browsed
 * manually. Collisions are resolved with a numeric suffix at creation time.
 */

export const WORKSPACE_VERSION = 1;

export const WORKSPACE_FILE = 'workspace.json';
export const PROJECTS_DIR = 'projects';
export const TAKES_DIR = 'takes';
export const PROJECT_FILE = 'project.json';
export const TAKE_FILE = 'take.json';
export const VIDEO_FILE = 'video.webm';
export const KEYPOINTS_FILE = 'raw-keypoints.bin';
export const THUMBNAIL_FILE = 'thumbnail.jpg';

export interface WorkspaceManifest {
  version: number;
  createdAt: string;
  app: string;
}

export interface ProjectManifest {
  version: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Everything needed to reconstruct a take without re-running inference. */
export interface TakeManifest {
  version: number;
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
  /** Wall-clock duration in seconds, as measured by the master clock. */
  durationSeconds: number;
  /** Frames actually captured (not the nominal fps x duration). */
  frameCount: number;
  /** Nominal capture rate requested from the camera. */
  captureFps: number;
  /** Measured mean inference rate over the take — the §17 acceptance number. */
  inferenceFps: number;
  source: {
    kind: 'camera' | 'file';
    /** Device label or file name. Diagnostic only; never a full path. */
    label: string;
    width: number;
    height: number;
  };
  models: {
    detector: string | null;
    pose2d: string | null;
    lift3d: string | null;
  };
  files: {
    video: string | null;
    keypoints: string | null;
    thumbnail: string | null;
  };
  /**
   * Which joints had their twist estimated rather than measured. Surfaced in the
   * UI as the twist caveat and carried here so an exported take stays honest
   * about its own provenance.
   */
  twistEstimatedJoints: string[];
}

export const projectDir = (projectId: string) => `${PROJECTS_DIR}/${projectId}`;
export const projectManifestPath = (projectId: string) =>
  `${projectDir(projectId)}/${PROJECT_FILE}`;
export const takesDir = (projectId: string) => `${projectDir(projectId)}/${TAKES_DIR}`;
export const takeDir = (projectId: string, takeId: string) =>
  `${takesDir(projectId)}/${takeId}`;
export const takeManifestPath = (projectId: string, takeId: string) =>
  `${takeDir(projectId, takeId)}/${TAKE_FILE}`;
export const takeVideoPath = (projectId: string, takeId: string) =>
  `${takeDir(projectId, takeId)}/${VIDEO_FILE}`;
export const takeKeypointsPath = (projectId: string, takeId: string) =>
  `${takeDir(projectId, takeId)}/${KEYPOINTS_FILE}`;
export const takeThumbnailPath = (projectId: string, takeId: string) =>
  `${takeDir(projectId, takeId)}/${THUMBNAIL_FILE}`;

/**
 * Turns a display name into a filesystem-safe slug.
 *
 * Conservative on purpose: this becomes a real directory name on the user's disk
 * under `fsa`, and Windows, macOS and Linux disagree about what is legal. ASCII
 * alphanumerics and dashes are safe everywhere.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug.length > 0 ? slug : 'untitled';
}

/** Appends `-2`, `-3`, ... until the slug is unused. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Timestamp-prefixed take id, so takes sort chronologically in a file browser. */
export function takeIdFor(date: Date, name: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${slugify(name)}`;
}
