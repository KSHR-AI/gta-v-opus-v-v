import * as THREE from 'three';
import { assets } from './assets.js';

const HEIGHT = 1.8;
const MODEL_HEIGHT = 2.7; // blocky characters are 2.7 units tall (feet at 0)
export const CHAR_SCALE = HEIGHT / MODEL_HEIGHT;

const gunGeo = {
  pistol: new THREE.BoxGeometry(0.12, 0.22, 0.45),
  smg: new THREE.BoxGeometry(0.14, 0.26, 0.75),
  shotgun: new THREE.BoxGeometry(0.14, 0.2, 1.15),
  rocket: new THREE.CylinderGeometry(0.16, 0.16, 1.5, 10).rotateX(Math.PI / 2),
};
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.5, metalness: 0.6 });
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x3c5a2a, roughness: 0.7 });

// Visual wrapper around a Kenney blocky character with an animation mixer.
export class CharacterModel {
  constructor(scene, modelName) {
    const { object, animations } = assets.cloneCharacter(modelName);
    this.root = new THREE.Group();
    object.scale.setScalar(CHAR_SCALE);
    this.root.add(object);
    this.inner = object;
    scene.add(this.root);
    this.scene = scene;
    this.mixer = new THREE.AnimationMixer(object);
    this.actions = {};
    for (const clip of animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.current = null;
    this.currentName = '';
    this.armRight = object.getObjectByName('arm-right');
    this.gun = null;
    this.play('idle');
  }

  play(name, { fade = 0.18, once = false, timeScale = 1, force = false } = {}) {
    const action = this.actions[name];
    if (!action) return;
    action.timeScale = timeScale;
    if (this.currentName === name && !force) return;
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.enabled = true;
    if (this.current && fade > 0) action.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    action.play();
    this.current = action;
    this.currentName = name;
  }

  setWeapon(kind) {
    if (this.gunKind === kind) return;
    this.gunKind = kind;
    if (this.gun) { this.gun.removeFromParent(); this.gun = null; }
    if (!kind || !gunGeo[kind] || !this.armRight) return;
    this.gun = new THREE.Mesh(gunGeo[kind], kind === 'rocket' ? rocketMat : gunMat);
    this.gun.castShadow = true;
    this.gun.scale.setScalar(1 / CHAR_SCALE);
    // hand sits at the bottom of the arm; the gun extends along the arm (-Y), which points forward when aiming
    const len = gunGeo[kind].parameters.depth ?? gunGeo[kind].parameters.height;
    this.gun.rotation.x = Math.PI / 2;
    this.gun.position.set(-0.2, -0.9 - (len * 0.3) / CHAR_SCALE, 0.05);
    this.armRight.add(this.gun);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (this.gun) {
      const len = this.gun.geometry.parameters.depth ?? this.gun.geometry.parameters.height ?? 0.5;
      return this.gun.localToWorld(out.set(0, 0, len / 2 + 0.05));
    }
    return this.root.localToWorld(out.set(0, 1.3, 0.5));
  }

  update(dt) { this.mixer.update(dt); }

  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
