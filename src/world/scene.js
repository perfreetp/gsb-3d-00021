import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class WorldScene {
  constructor(container) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xaab8c6, 90, 220);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 600);
    this.camera.position.set(26, 18, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 130;
    this.controls.target.set(0, 3, -10);

    this.addLights();
    this.addSky();

    window.addEventListener('resize', () => this.onResize(container));
  }

  addLights() {
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x4a4038, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
    sun.position.set(45, 60, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fc0e8, 0.4);
    fill.position.set(-30, 20, -40);
    this.scene.add(fill);
  }

  addSky() {
    const geo = new THREE.SphereGeometry(400, 24, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(0x2f6db3) },
        mid: { value: new THREE.Color(0x9fc3e0) },
        bot: { value: new THREE.Color(0xe8eef2) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){ float h = normalize(vP).y;
          vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0,0.7,h)) : mix(mid, bot, smoothstep(-0.25,0.0,h));
          gl_FragColor = vec4(c,1.0);}`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  setView(name) {
    const views = {
      overview: [[26, 18, 30], [0, 3, -10]],
      bridge: [[4, 8, -16], [0, 4, -8]],
      door: [[-5.5, 4.6, -11.5], [0, 2.5, -7.2]],
      top: [[0.1, 70, 0.1], [0, 0, -8]],
    };
    const [pos, tgt] = views[name] || views.overview;
    this._viewTween = { from: this.camera.position.clone(), to: new THREE.Vector3(...pos),
      tFrom: this.controls.target.clone(), tTo: new THREE.Vector3(...tgt), t: 0 };
  }

  updateViewTween(dt) {
    if (!this._viewTween) return;
    const tw = this._viewTween;
    tw.t = Math.min(1, tw.t + dt / 0.9);
    const k = 1 - Math.pow(1 - tw.t, 3);
    this.camera.position.lerpVectors(tw.from, tw.to, k);
    this.controls.target.lerpVectors(tw.tFrom, tw.tTo, k);
    if (tw.t >= 1) this._viewTween = null;
  }

  onResize(container) {
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  render() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
