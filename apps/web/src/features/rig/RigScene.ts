/**
 * The Three.js rig scene (Document 2 §8, extended per addendum §B.1).
 *
 * Written as a plain class with an explicit lifecycle rather than as React
 * components (no react-three-fiber). Three reasons:
 *
 * 1. The render loop must run at 60fps **independently of React**, reading the
 *    rig ring buffer directly. Routing 21 joint transforms per frame through
 *    React state would be the single worst thing we could do for frame time.
 * 2. Dock panels mount, unmount, resize and re-tab constantly. Owning the WebGL
 *    context explicitly makes it obvious when it is created and destroyed —
 *    §B.1.4 requires that a workspace-tab switch not tear it down.
 * 3. It is testable without a DOM: every method below can be driven from a test
 *    with a stub renderer.
 *
 * Coordinate conventions are the ones fixed in docs/decisions.md: Y-up,
 * right-handed, +X is the character's left, the character faces -Z, metres.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

import {
  JOINT_NAMES,
  jointIndex,
  PARENTS,
  REST_OFFSETS,
  restWorldPositions,
} from './rigSkeleton';

export interface RigSceneOptions {
  canvas: HTMLCanvasElement;
  /** Device pixel ratio cap. 2 is plenty; higher murders fill rate for nothing. */
  maxPixelRatio?: number;
}

export interface RigDisplayToggles {
  grid: boolean;
  worldAxes: boolean;
  skeleton: boolean;
  capsuleBody: boolean;
  cameraFrustum: boolean;
  navGizmo: boolean;
}

/** Axis colours, consistent everywhere in the app that shows axes (§B.1.2). */
export const AXIS_COLORS = {
  x: 0xff453a,
  y: 0x30d158,
  z: 0x0a84ff,
} as const;

const JOINT_RADIUS = 0.022;
const NAV_GIZMO_SIZE = 96;

/** Standard view directions for the numpad-style snaps (§B.1.1). */
export const VIEW_SNAPS = {
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
  bottom: new THREE.Vector3(0, -1, 0),
} as const;

export type ViewSnapName = keyof typeof VIEW_SNAPS;

export class RigScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly transformControls: TransformControls;
  /**
   * Three r16x split TransformControls from its renderable helper: the controls
   * object is no longer an Object3D, so visibility and scene-attachment live
   * here instead.
   */
  private readonly transformHelper: THREE.Object3D;

  /** Small second scene for the corner navigation gizmo (§B.1.2). */
  private readonly gizmoScene = new THREE.Scene();
  private readonly gizmoCamera: THREE.PerspectiveCamera;
  private readonly gizmoGroup = new THREE.Group();

  private readonly jointMeshes: THREE.Mesh[] = [];
  private readonly boneMeshes: THREE.Mesh[] = [];
  private readonly capsuleMeshes: THREE.Mesh[] = [];
  private readonly skeletonGroup = new THREE.Group();
  private readonly capsuleGroup = new THREE.Group();
  private grid: THREE.GridHelper;
  private worldAxes: THREE.AxesHelper;
  private frustum: THREE.LineSegments;

  /** Scratch objects, reused every frame so the render loop never allocates. */
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly worldPositions: THREE.Vector3[];
  private readonly worldQuaternions: THREE.Quaternion[];

  /** In-flight camera animation, if any. */
  private cameraAnimation: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;

  private disposed = false;

  constructor(options: RigSceneOptions) {
    const { canvas, maxPixelRatio = 2 } = options;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, maxPixelRatio));
    // The gizmo is drawn as a second scissored pass, so autoClear must stay on
    // for the main pass and be managed manually for the overlay.
    this.renderer.autoClear = true;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    this.camera.position.set(2.6, 1.7, 3.2);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.95, 0);
    // Pan in world-XZ rather than screen space: for a character on a ground
    // plane, screen-space panning drifts the target off the floor and the orbit
    // pivot ends up somewhere useless.
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = 40;
    // Stop just short of the poles; going through them flips the up vector.
    this.controls.maxPolarAngle = Math.PI * 0.98;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    this.transformControls = new TransformControls(this.camera, canvas);
    this.transformControls.enabled = false;
    // Dragging the gizmo must not also orbit the camera.
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.controls.enabled = !(event as unknown as { value: boolean }).value;
    });
    this.transformHelper =
      (this.transformControls as unknown as { getHelper?: () => THREE.Object3D }).getHelper?.() ??
      (this.transformControls as unknown as THREE.Object3D);
    this.transformHelper.visible = false;
    this.scene.add(this.transformHelper);

    // ---- lighting: neutral studio setup, no shadows (cost without benefit here)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbdd6ff, 0.5);
    fill.position.set(-4, 2, -3);
    this.scene.add(fill);

    // ---- ground grid and world axes
    this.grid = new THREE.GridHelper(10, 20, 0x8e8e93, 0xc7c7cc);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.scene.add(this.grid);

    this.worldAxes = new THREE.AxesHelper(0.5);
    this.scene.add(this.worldAxes);

    this.frustum = this.buildFrustum();
    this.frustum.visible = false;
    this.scene.add(this.frustum);

    // ---- rig geometry
    this.scene.add(this.skeletonGroup);
    this.scene.add(this.capsuleGroup);
    this.worldPositions = JOINT_NAMES.map(() => new THREE.Vector3());
    this.worldQuaternions = JOINT_NAMES.map(() => new THREE.Quaternion());
    this.buildSkeleton();
    this.buildCapsules();

    // ---- navigation gizmo
    this.gizmoCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 10);
    this.gizmoCamera.position.set(0, 0, 3.2);
    this.gizmoScene.add(this.gizmoGroup);
    this.buildNavGizmo();

    this.applyRestPose();
  }

  // ------------------------------------------------------------------
  // Construction helpers
  // ------------------------------------------------------------------

  private buildSkeleton(): void {
    const jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 16, 12);
    const jointMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a84ff,
      roughness: 0.35,
      metalness: 0.1,
    });
    // Bones are unit-height cylinders scaled per frame, so one geometry serves all.
    const boneGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 8);
    boneGeometry.translate(0, 0.5, 0); // origin at the base, so scaling grows upward
    const boneMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5f5f7,
      roughness: 0.5,
      metalness: 0.05,
    });

    for (let i = 0; i < JOINT_NAMES.length; i += 1) {
      const joint = new THREE.Mesh(jointGeometry, jointMaterial);
      joint.name = `joint:${JOINT_NAMES[i]}`;
      joint.userData.jointName = JOINT_NAMES[i];
      joint.userData.jointIndex = i;
      this.jointMeshes.push(joint);
      this.skeletonGroup.add(joint);

      if (PARENTS[i]! >= 0) {
        const bone = new THREE.Mesh(boneGeometry, boneMaterial);
        bone.name = `bone:${JOINT_NAMES[i]}`;
        bone.userData.jointIndex = i;
        this.boneMeshes.push(bone);
        this.skeletonGroup.add(bone);
      }
    }
  }

  /**
   * Capsule proxy body: one capsule per bone, giving the rig visible volume so
   * depth is readable. Sized from the rest skeleton and then only transformed,
   * never rebuilt, since rebuilding geometry per frame would defeat the purpose.
   */
  private buildCapsules(): void {
    const rest = restWorldPositions();
    const material = new THREE.MeshStandardMaterial({
      color: 0x8e8e93,
      roughness: 0.65,
      metalness: 0.05,
      transparent: true,
      opacity: 0.55,
    });

    for (let i = 0; i < JOINT_NAMES.length; i += 1) {
      const parent = PARENTS[i]!;
      if (parent < 0) continue;
      const restLength = rest[i]!.distanceTo(rest[parent]!);
      if (restLength < 1e-4) continue;

      const radius = Math.min(0.055, Math.max(0.02, restLength * 0.18));
      const geometry = new THREE.CapsuleGeometry(radius, Math.max(restLength - radius * 2, 0.01), 4, 10);
      geometry.translate(0, restLength / 2, 0);
      const capsule = new THREE.Mesh(geometry, material);
      capsule.userData.jointIndex = i;
      capsule.userData.restLength = restLength;
      this.capsuleMeshes.push(capsule);
      this.capsuleGroup.add(capsule);
    }
  }

  /** Wireframe frustum for the source camera, default 60° FOV (§B.1.2). */
  private buildFrustum(fovDegrees = 60, aspect = 16 / 9, far = 2.5): THREE.LineSegments {
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2) * far;
    const halfWidth = halfHeight * aspect;
    const apex = new THREE.Vector3(0, 0, 0);
    const corners = [
      new THREE.Vector3(-halfWidth, -halfHeight, -far),
      new THREE.Vector3(halfWidth, -halfHeight, -far),
      new THREE.Vector3(halfWidth, halfHeight, -far),
      new THREE.Vector3(-halfWidth, halfHeight, -far),
    ];
    const points: THREE.Vector3[] = [];
    for (const corner of corners) {
      points.push(apex.clone(), corner.clone());
    }
    for (let i = 0; i < 4; i += 1) {
      points.push(corners[i]!.clone(), corners[(i + 1) % 4]!.clone());
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xffd60a, transparent: true, opacity: 0.8 }),
    );
    // Place it where a camera filming the subject would plausibly sit.
    lines.position.set(0, 1.3, 3.0);
    return lines;
  }

  /** Six labelled axis handles the user can click to snap the camera. */
  private buildNavGizmo(): void {
    const handleGeometry = new THREE.SphereGeometry(0.28, 16, 12);
    const axes: { dir: THREE.Vector3; color: number; name: ViewSnapName; positive: boolean }[] = [
      { dir: new THREE.Vector3(1, 0, 0), color: AXIS_COLORS.x, name: 'right', positive: true },
      { dir: new THREE.Vector3(-1, 0, 0), color: AXIS_COLORS.x, name: 'left', positive: false },
      { dir: new THREE.Vector3(0, 1, 0), color: AXIS_COLORS.y, name: 'top', positive: true },
      { dir: new THREE.Vector3(0, -1, 0), color: AXIS_COLORS.y, name: 'bottom', positive: false },
      { dir: new THREE.Vector3(0, 0, 1), color: AXIS_COLORS.z, name: 'front', positive: true },
      { dir: new THREE.Vector3(0, 0, -1), color: AXIS_COLORS.z, name: 'back', positive: false },
    ];

    for (const axis of axes) {
      const material = new THREE.MeshBasicMaterial({
        color: axis.color,
        transparent: true,
        // Negative handles are hollow-looking, as in Blender, so orientation
        // is readable at a glance rather than only from the labels.
        opacity: axis.positive ? 1 : 0.45,
      });
      const handle = new THREE.Mesh(handleGeometry, material);
      handle.position.copy(axis.dir).multiplyScalar(1.15);
      handle.userData.snap = axis.name;
      this.gizmoGroup.add(handle);

      if (axis.positive) {
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 1.15, 6),
          new THREE.MeshBasicMaterial({ color: axis.color }),
        );
        stem.position.copy(axis.dir).multiplyScalar(0.575);
        stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.dir);
        this.gizmoGroup.add(stem);
      }
    }
  }

  // ------------------------------------------------------------------
  // Pose updates
  // ------------------------------------------------------------------

  /** Places the rig in its rest T-pose. Used before any pose data arrives. */
  applyRestPose(): void {
    const identity = new Float32Array(JOINT_NAMES.length * 4);
    for (let i = 0; i < JOINT_NAMES.length; i += 1) identity[i * 4 + 3] = 1;
    this.applyPose(new Float32Array([0, REST_OFFSETS[0]![1], 0]), identity);
  }

  /**
   * Applies one rig frame: root position plus 21 parent-relative quaternions,
   * exactly the layout `retarget_pose` emits and the rig ring buffer carries.
   *
   * Runs forward kinematics here rather than relying on Three's scene graph so
   * the joint/bone/capsule meshes can stay flat children of one group — a flat
   * list is far cheaper to traverse than a 21-deep nested hierarchy, and we
   * already need the world positions to place the bones.
   */
  applyPose(root: Float32Array | number[], quats: Float32Array | number[]): void {
    const jointCount = JOINT_NAMES.length;

    for (let i = 0; i < jointCount; i += 1) {
      const parent = PARENTS[i]!;
      this.tmpQuat.set(
        quats[i * 4 + 0] ?? 0,
        quats[i * 4 + 1] ?? 0,
        quats[i * 4 + 2] ?? 0,
        quats[i * 4 + 3] ?? 1,
      );

      if (parent < 0) {
        this.worldQuaternions[i]!.copy(this.tmpQuat);
        this.worldPositions[i]!.set(root[0] ?? 0, root[1] ?? 0, root[2] ?? 0);
      } else {
        this.worldQuaternions[i]!.copy(this.worldQuaternions[parent]!).multiply(this.tmpQuat);
        const offset = REST_OFFSETS[i]!;
        this.tmpVec.set(offset[0], offset[1], offset[2]).applyQuaternion(
          this.worldQuaternions[parent]!,
        );
        this.worldPositions[i]!.copy(this.worldPositions[parent]!).add(this.tmpVec);
      }
    }

    for (let i = 0; i < jointCount; i += 1) {
      this.jointMeshes[i]!.position.copy(this.worldPositions[i]!);
    }

    for (const bone of this.boneMeshes) {
      const i = bone.userData.jointIndex as number;
      const parent = PARENTS[i]!;
      this.orientBetween(bone, this.worldPositions[parent]!, this.worldPositions[i]!, true);
    }

    for (const capsule of this.capsuleMeshes) {
      const i = capsule.userData.jointIndex as number;
      const parent = PARENTS[i]!;
      const restLength = capsule.userData.restLength as number;
      this.orientBetween(capsule, this.worldPositions[parent]!, this.worldPositions[i]!, false);
      // Stretch along the bone axis only, so the capsule's girth stays constant
      // when a limb is foreshortened.
      const length = this.worldPositions[parent]!.distanceTo(this.worldPositions[i]!);
      capsule.scale.set(1, length / restLength, 1);
    }
  }

  /** Points `object`'s +Y axis from `from` to `to`, optionally scaling to fit. */
  private orientBetween(
    object: THREE.Object3D,
    from: THREE.Vector3,
    to: THREE.Vector3,
    scaleToLength: boolean,
  ): void {
    object.position.copy(from);
    this.tmpVecB.copy(to).sub(from);
    const length = this.tmpVecB.length();
    if (length < 1e-6) {
      object.visible = false;
      return;
    }
    object.visible = true;
    this.tmpVecB.divideScalar(length);
    object.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, this.tmpVecB);
    if (scaleToLength) object.scale.set(1, length, 1);
  }

  /** World position of a joint by name, for framing and the inspector. */
  jointPosition(name: string): THREE.Vector3 | null {
    const index = jointIndex(name);
    return index === -1 ? null : this.worldPositions[index]!.clone();
  }

  // ------------------------------------------------------------------
  // Display toggles and camera
  // ------------------------------------------------------------------

  setToggles(toggles: Partial<RigDisplayToggles>): void {
    if (toggles.grid !== undefined) this.grid.visible = toggles.grid;
    if (toggles.worldAxes !== undefined) this.worldAxes.visible = toggles.worldAxes;
    if (toggles.skeleton !== undefined) this.skeletonGroup.visible = toggles.skeleton;
    if (toggles.capsuleBody !== undefined) this.capsuleGroup.visible = toggles.capsuleBody;
    if (toggles.cameraFrustum !== undefined) this.frustum.visible = toggles.cameraFrustum;
  }

  /** Bounding box of the rig, used by Frame All / Frame Selected. */
  boundingBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const position of this.worldPositions) box.expandByPoint(position);
    // Pad so the silhouette is not flush against the viewport edges.
    box.expandByScalar(0.15);
    return box;
  }

  /**
   * Moves the camera so `box` fills the view, animating over `durationMs`.
   *
   * Distance is derived from the vertical FOV and then widened for the
   * horizontal one when the panel is narrow — otherwise a tall thin dock panel
   * crops the character's arms.
   */
  frameBox(box: THREE.Box3, durationMs = 250): void {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitHeightDistance = size.y / (2 * Math.tan(fov / 2));
    const fitWidthDistance = size.x / (2 * Math.tan(fov / 2) * this.camera.aspect);
    const distance = 1.25 * Math.max(fitHeightDistance, fitWidthDistance, 0.5);

    // Approach along the current view direction so framing never spins the view.
    const direction = this.tmpVec
      .copy(this.camera.position)
      .sub(this.controls.target)
      .normalize();
    if (direction.lengthSq() < 1e-6) direction.set(0, 0.3, 1).normalize();

    this.animateCameraTo(
      center.clone().add(direction.multiplyScalar(distance)),
      center,
      durationMs,
    );
  }

  frameAll(durationMs = 250): void {
    this.frameBox(this.boundingBox(), durationMs);
  }

  frameJoint(name: string, durationMs = 250): void {
    const position = this.jointPosition(name);
    if (!position) return;
    const box = new THREE.Box3().setFromCenterAndSize(position, new THREE.Vector3(0.6, 0.6, 0.6));
    this.frameBox(box, durationMs);
  }

  /** Snaps to a canonical view direction (§B.1.1 numpad shortcuts). */
  snapToView(name: ViewSnapName, durationMs = 250): void {
    const direction = VIEW_SNAPS[name];
    const box = this.boundingBox();
    const center = box.isEmpty() ? new THREE.Vector3(0, 0.95, 0) : box.getCenter(new THREE.Vector3());
    const distance = this.camera.position.distanceTo(this.controls.target) || 4;
    this.animateCameraTo(
      center.clone().add(direction.clone().multiplyScalar(distance)),
      center,
      durationMs,
    );
  }

  resetCamera(durationMs = 250): void {
    this.animateCameraTo(
      new THREE.Vector3(2.6, 1.7, 3.2),
      new THREE.Vector3(0, 0.95, 0),
      durationMs,
    );
  }

  private animateCameraTo(
    position: THREE.Vector3,
    target: THREE.Vector3,
    durationMs: number,
  ): void {
    if (durationMs <= 0) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.cameraAnimation = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      start: performance.now(),
      duration: durationMs,
    };
  }

  /** The design system's `apple-out` curve, as a scalar easing function. */
  private static easeAppleOut(t: number): number {
    // cubic-bezier(0.16, 1, 0.3, 1) approximated by an exponential ease-out,
    // which is visually indistinguishable here and far cheaper than solving the
    // bezier every frame.
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  private stepCameraAnimation(now: number): void {
    const animation = this.cameraAnimation;
    if (!animation) return;
    const raw = Math.min(1, (now - animation.start) / animation.duration);
    const t = RigScene.easeAppleOut(raw);
    this.camera.position.lerpVectors(animation.fromPos, animation.toPos, t);
    this.controls.target.lerpVectors(animation.fromTarget, animation.toTarget, t);
    if (raw >= 1) this.cameraAnimation = null;
  }

  /** True while a programmatic camera move is in flight. */
  get isAnimatingCamera(): boolean {
    return this.cameraAnimation !== null;
  }

  // ------------------------------------------------------------------
  // Selection / transform gizmo scaffold
  // ------------------------------------------------------------------

  /** Attaches the transform gizmo to a joint, or detaches when null. */
  setSelection(jointName: string | null): void {
    if (!jointName) {
      this.transformControls.detach();
      this.transformHelper.visible = false;
      this.transformControls.enabled = false;
      return;
    }
    const index = jointIndex(jointName);
    if (index === -1) return;
    this.transformControls.attach(this.jointMeshes[index]!);
    this.transformHelper.visible = true;
    // Deliberately not interactive yet — Document 4 enables dragging. The gizmo
    // is shown so the plumbing is visibly correct.
    this.transformControls.enabled = false;
  }

  /** Raycasts against joint spheres. Returns the joint name, or null. */
  pickJoint(ndcX: number, ndcY: number): string | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = raycaster.intersectObjects(this.jointMeshes, false);
    const first = hits[0];
    return first ? ((first.object.userData.jointName as string) ?? null) : null;
  }

  /** Raycasts against the navigation gizmo handles. Returns a snap name. */
  pickNavGizmo(ndcX: number, ndcY: number): ViewSnapName | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.gizmoCamera);
    const hits = raycaster.intersectObjects(this.gizmoGroup.children, false);
    for (const hit of hits) {
      const snap = hit.object.userData.snap as ViewSnapName | undefined;
      if (snap) return snap;
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Frame loop
  // ------------------------------------------------------------------

  /**
   * Resizes the renderer and camera to the panel's content box.
   *
   * Called from a `ResizeObserver` on the panel element, NOT from a window
   * resize listener: dock panels resize constantly while the window does not
   * (§B.1.4).
   */
  resize(width: number, height: number): void {
    if (this.disposed || width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /** Renders one frame. Call from the panel's rAF loop. */
  render(now = performance.now(), showNavGizmo = true): void {
    if (this.disposed) return;
    this.stepCameraAnimation(now);
    this.controls.update();
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);

    if (showNavGizmo) this.renderNavGizmo();
  }

  /**
   * Draws the nav gizmo as a scissored second pass into the same GL context.
   *
   * A second `WebGLRenderer` would mean a second GL context — browsers cap those
   * at ~16 per page and each carries real memory cost, so the scissor approach
   * is both cheaper and safer (§B.1.2 calls for exactly this).
   */
  private renderNavGizmo(): void {
    const size = this.renderer.getSize(this.tmpVecB as unknown as THREE.Vector2);
    const width = (size as unknown as THREE.Vector2).x;
    const height = (size as unknown as THREE.Vector2).y;
    const inset = 8;
    const x = width - NAV_GIZMO_SIZE - inset;
    const y = height - NAV_GIZMO_SIZE - inset;
    if (x < 0 || y < 0) return;

    // The gizmo mirrors the main camera's orientation about the origin.
    this.tmpMat.copy(this.camera.matrixWorld).invert();
    this.gizmoGroup.quaternion.setFromRotationMatrix(this.tmpMat);

    this.renderer.setScissorTest(true);
    this.renderer.setScissor(x, y, NAV_GIZMO_SIZE, NAV_GIZMO_SIZE);
    this.renderer.setViewport(x, y, NAV_GIZMO_SIZE, NAV_GIZMO_SIZE);
    this.renderer.clearDepth();
    this.renderer.render(this.gizmoScene, this.gizmoCamera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, width, height);
  }

  /** Where the nav gizmo sits, in CSS pixels from the panel's top-left. */
  navGizmoRect(cssWidth: number, cssHeight: number): { x: number; y: number; size: number } {
    const inset = 8;
    void cssHeight;
    return { x: cssWidth - NAV_GIZMO_SIZE - inset, y: inset, size: NAV_GIZMO_SIZE };
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls.dispose();
    this.transformControls.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.gizmoScene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | undefined;
      material?.dispose();
    });
    this.renderer.dispose();
  }
}
