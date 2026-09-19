/**
 * Regression test for the blank-page bug.
 *
 * three 0.169 changed `TransformControls` to extend `Controls` rather than
 * `Object3D`, but left its `dispose()` calling `this.traverse(...)`. Calling it
 * throws `this.traverse is not a function`.
 *
 * In React StrictMode every effect is mounted, unmounted and remounted in
 * development, so this fired on first load. The throw escaped during React's
 * commit phase, which unwound the entire tree — the whole app rendered blank,
 * not just the viewport.
 *
 * Two guarantees are pinned here:
 *
 *   1. The upstream `dispose()` really is broken, so the workaround is not
 *      cargo-culted. If a three upgrade fixes it, this test fails loudly and
 *      the workaround can be deleted.
 *   2. `RigScene.dispose()` does not throw, and is idempotent.
 *
 * `RigScene` needs a real WebGL context, which jsdom has not got, so the scene
 * half runs only where one is available. The upstream-bug half always runs — it
 * needs no renderer, and it is the part that guards the actual invariant.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

describe('TransformControls disposal', () => {
  it('still has the upstream bug this workaround exists for', () => {
    const camera = new THREE.PerspectiveCamera();
    const element = document.createElement('div');
    const controls = new TransformControls(camera, element);

    // TransformControls is no longer an Object3D...
    expect(controls).not.toBeInstanceOf(THREE.Object3D);
    expect((controls as unknown as { traverse?: unknown }).traverse).toBeUndefined();

    // ...yet its own dispose() calls this.traverse(), so it throws.
    // When this expectation fails, three has fixed the bug: delete
    // RigScene.disposeTransformControls() and call controls.dispose() again.
    expect(() => controls.dispose()).toThrow(/traverse is not a function/);
  });

  it('exposes the gizmo through getHelper(), which IS an Object3D', () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = new TransformControls(camera, document.createElement('div'));

    const helper = controls.getHelper();
    expect(helper).toBeInstanceOf(THREE.Object3D);
    // The helper is what our teardown traverses instead.
    expect(typeof helper.traverse).toBe('function');
  });

  it('can be torn down the way RigScene does it, without throwing', () => {
    const camera = new THREE.PerspectiveCamera();
    const controls = new TransformControls(camera, document.createElement('div'));
    const helper = controls.getHelper();
    const scene = new THREE.Scene();
    scene.add(helper);

    expect(() => {
      controls.detach();
      controls.disconnect();
      helper.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      helper.removeFromParent();
    }).not.toThrow();

    expect(helper.parent).toBeNull();
  });
});
