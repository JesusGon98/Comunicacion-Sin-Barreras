// Mano 3D realista dibujada con three.js a partir de los 21 puntos de la mano.
//
// No usa ningún modelo descargado: la mano se "construye" con formas sencillas
// que se recalculan en cada cuadro de la animación:
//   - Palma: una superficie redondeada que envuelve la muñeca, los nudillos y la base del pulgar.
//   - Dedos: tubos que se van adelgazando hacia la punta, con articulaciones redondas.
//   - Uñas: pequeñas elipses brillantes sobre la última falange.
//   - Antebrazo: para que la mano no se vea "flotando".
// La piel usa un material físico (con brillo suave tipo terciopelo) y tres luces,
// y los dedos proyectan sombra sobre la palma. Así se entiende qué dedo va delante.
//
// Como usa los mismos 63 números que el reconocimiento, cualquier seña grabada
// (personal o del paquete oficial) se puede ver en 3D.
//
// Si más adelante se consigue una mano .glb con huesos (por ejemplo hecha en Blender),
// se puede crear otra clase con los mismos métodos (render, setSkin, dispose)
// y cambiarla en SignPlayer sin tocar nada más.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { poseBounds, type Bounds } from './skeleton';

// Puntos de cada dedo, de la base a la punta (numeración de MediaPipe)
const FINGERS = [
  [1, 2, 3, 4], // pulgar
  [5, 6, 7, 8], // índice
  [9, 10, 11, 12], // medio
  [13, 14, 15, 16], // anular
  [17, 18, 19, 20], // meñique
];

// Medidas en "tamaños de mano": la distancia muñeca → nudillo del dedo medio vale 1 (≈ 9.5 cm).
const FINGER_SCALE = [1, 1, 1.03, 0.95, 0.83]; // grosor relativo de cada dedo
const FINGER_RADIUS = [0.108, 0.097, 0.087, 0.077]; // nudillo, 2.ª articulación, 3.ª, punta
const THUMB_RADIUS = [0.15, 0.124, 0.107, 0.093]; // base, nudillo, articulación, punta

/** Radio del dedo en un punto. */
function radiusAt(point: number): number {
  const finger = Math.floor((point - 1) / 4);
  const k = (point - 1) % 4;
  return finger === 0 ? THUMB_RADIUS[k] : FINGER_RADIUS[k] * FINGER_SCALE[finger];
}

/** Direcciones repartidas por una esfera (para redondear la palma). */
function sphereDirections(n: number): THREE.Vector3[] {
  const dirs: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    dirs.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  return dirs;
}
const DIRS = sphereDirections(40);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export class Hand3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  private pivot = new THREE.Group(); // se gira cuando la persona arrastra el dedo
  private hand = new THREE.Group();
  private skin: THREE.MeshPhysicalMaterial;
  private nailMaterial: THREE.MeshPhysicalMaterial;
  private keyLight: THREE.DirectionalLight;
  private envTexture: THREE.Texture;

  private joints: THREE.Mesh[] = []; // índice = punto de MediaPipe (0 no se usa)
  private segments: { mesh: THREE.Mesh; a: number; b: number }[] = [];
  private nails: THREE.Mesh[] = [];
  private palm: THREE.Mesh;
  private forearm: THREE.Mesh;

  // Puntos de la mano en 3D (se reutilizan para no crear basura en cada cuadro)
  private P = Array.from({ length: 21 }, () => new THREE.Vector3());
  private hullPoints: THREE.Vector3[] = [];

  // Giro de la vista
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  private drag: { x: number; y: number; id: number; mouse: boolean } | null = null;
  /** Avisa si la vista está girada (para mostrar el botón "Vista de frente"). */
  onRotatedChange?: (rotated: boolean) => void;
  private rotated = false;

  constructor(private canvas: HTMLCanvasElement, skinColor: string) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;

    // Reflejos suaves de un "cuarto" generado por código (funciona sin internet)
    const pmrem = new THREE.PMREMGenerator(r);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity = 0.55;

    // Luces: principal (con sombra), de relleno y de contorno (separa la mano del fondo oscuro)
    this.scene.add(new THREE.HemisphereLight(0xfff6ee, 0x3a2a22, 0.45));
    const key = new THREE.DirectionalLight(0xfff1e3, 2.4);
    key.position.set(3, 4, 3.5); // de lado y desde arriba: marca mejor el volumen
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 4;
    this.keyLight = key;
    this.scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xd9e6ff, 0.7);
    fill.position.set(-4, 0.5, 3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(-1, 3, -5);
    this.scene.add(rim);

    // Materiales: piel con brillo suave tipo terciopelo (sheen) y uñas brillantes
    this.skin = new THREE.MeshPhysicalMaterial({
      roughness: 0.58,
      metalness: 0,
      sheen: 0.6,
      sheenRoughness: 0.55,
      clearcoat: 0.08,
      clearcoatRoughness: 0.6,
    });
    this.nailMaterial = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    this.setSkin(skinColor);

    this.scene.add(this.pivot);
    this.pivot.add(this.hand);
    this.buildMeshes();
    this.palm = this.addMesh(new THREE.BufferGeometry(), this.skin);
    this.forearm = this.addMesh(new THREE.CylinderGeometry(1, 1.15, 1, 40, 1, true), this.skin);
    this.forearm.matrixAutoUpdate = false;

    this.listenToDrag();
  }

  /** Cambia el tono de piel. */
  setSkin(color: string) {
    const c = new THREE.Color(color);
    this.skin.color.copy(c);
    // Brillo rojizo suave: imita la luz que atraviesa un poco la piel
    this.skin.sheenColor.copy(c).lerp(new THREE.Color('#ff8a6a'), 0.45);
    // Uña: el mismo tono, más claro y rosado
    this.nailMaterial.color.copy(c).lerp(new THREE.Color('#f2c4bb'), 0.3);
  }

  /** Vuelve a la vista de frente. */
  resetView() {
    this.targetYaw = 0;
    this.targetPitch = 0;
  }

  private addMesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.hand.add(mesh);
    return mesh;
  }

  /** Crea una sola vez las piezas de los dedos (luego solo se mueven). */
  private buildMeshes() {
    // Articulaciones: esferas del mismo radio que el dedo (la 2.ª y 3.ª un poco más gruesas, como nudillos)
    for (let p = 0; p <= 20; p++) {
      if (p === 0) {
        this.joints.push(new THREE.Mesh()); // la muñeca la cubre la palma
        continue;
      }
      const k = (p - 1) % 4;
      const bump = k === 1 || k === 2 ? 1.012 : 1;
      this.joints.push(this.addMesh(new THREE.SphereGeometry(radiusAt(p) * bump, 28, 18), this.skin));
    }
    // Falanges: tubos que se adelgazan (de un radio al del punto siguiente)
    for (const finger of FINGERS) {
      for (let s = 0; s < 3; s++) {
        const a = finger[s];
        const b = finger[s + 1];
        const geo = new THREE.CylinderGeometry(radiusAt(b), radiusAt(a), 1, 28, 1, true);
        this.segments.push({ mesh: this.addMesh(geo, this.skin), a, b });
      }
      const nail = this.addMesh(new THREE.SphereGeometry(1, 24, 14), this.nailMaterial);
      nail.matrixAutoUpdate = false;
      this.nails.push(nail);
    }
  }

  /**
   * Dibuja una pose.
   * @param pose 63 números (21 puntos × x, y, z) normalizados, o null para no mostrar mano.
   * @param mirror true = vista de espejo.
   * @param bounds zona que ocupa todo el movimiento (para que no "salte" el encuadre).
   */
  render(pose: number[] | null, mirror: boolean, bounds?: Bounds) {
    this.resize();
    this.updateView();
    this.hand.visible = Boolean(pose);
    if (pose) this.updateHand(pose, mirror, bounds ?? poseBounds([pose]));
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Giro suave hacia donde la persona arrastró. */
  private updateView() {
    this.yaw += (this.targetYaw - this.yaw) * 0.25;
    this.pitch += (this.targetPitch - this.pitch) * 0.25;
    this.pivot.rotation.set(this.pitch, this.yaw, 0);
    const rotated = Math.abs(this.targetYaw) > 0.05 || Math.abs(this.targetPitch) > 0.05;
    if (rotated !== this.rotated) {
      this.rotated = rotated;
      this.onRotatedChange?.(rotated);
    }
  }

  private updateHand(pose: number[], mirror: boolean, b: Bounds) {
    const P = this.P;
    const flip = mirror ? 1 : -1;

    // 1. Pasar los puntos a 3D. En los datos "y" crece hacia abajo y "z" negativa = hacia la cámara;
    //    en three.js "y" crece hacia arriba y la cámara mira hacia "z" negativa.
    let cz = 0;
    for (let i = 0; i < 21; i++) {
      P[i].set(pose[i * 3] * flip, -pose[i * 3 + 1], -pose[i * 3 + 2]);
      cz += P[i].z / 21;
    }

    // 2. Encuadre: centramos la zona de la seña y alejamos la cámara lo necesario
    const minX = mirror ? b.minX : -b.maxX;
    const maxX = mirror ? b.maxX : -b.minX;
    const center = new THREE.Vector3((minX + maxX) / 2, -(b.minY + b.maxY) / 2, cz);
    for (const p of P) p.sub(center);
    const spanX = Math.max(maxX - minX + 0.6, 2.1);
    const spanY = Math.max(b.maxY - b.minY + 0.6, 2.1);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(spanY / 2 / tan, spanX / 2 / (tan * this.camera.aspect)) * 1.08;
    this.camera.position.set(0, 0, dist + 1);
    this.camera.lookAt(0, 0, 0);
    const shadowCam = this.keyLight.shadow.camera;
    const half = Math.max(spanX, spanY) / 2 + 0.6;
    if (shadowCam.right !== half) {
      Object.assign(shadowCam, { left: -half, right: half, top: half, bottom: -half, near: 0.1, far: 30 });
      shadowCam.updateProjectionMatrix();
    }

    // 3. Ejes de la mano
    //    lateral: del meñique hacia el índice · dorso: hacia el dorso de la mano
    const lateral = new THREE.Vector3().subVectors(P[5], P[17]).normalize();
    const dorsal = new THREE.Vector3()
      .crossVectors(new THREE.Vector3().subVectors(P[5], P[0]), new THREE.Vector3().subVectors(P[17], P[0]))
      .normalize()
      .multiplyScalar(flip); // el espejo invierte el sentido del producto cruz
    // Comprobación: los dedos se doblan hacia la palma, nunca hacia el dorso
    let curl = 0;
    for (const f of FINGERS.slice(1)) curl += new THREE.Vector3().subVectors(P[f[3]], P[f[0]]).dot(dorsal);
    if (curl > 0.3) dorsal.negate();

    // 4. Articulaciones y falanges
    for (let p = 1; p <= 20; p++) this.joints[p].position.copy(P[p]);
    const dir = new THREE.Vector3();
    for (const { mesh, a, b: bi } of this.segments) {
      dir.subVectors(P[bi], P[a]);
      const len = dir.length();
      mesh.visible = len > 1e-4;
      if (!mesh.visible) continue;
      mesh.position.addVectors(P[a], P[bi]).multiplyScalar(0.5);
      mesh.quaternion.setFromUnitVectors(Y_AXIS, dir.divideScalar(len));
      mesh.scale.set(1, len, 1);
    }

    // 5. Uñas sobre la última falange, del lado del dorso
    const fingerAxis = new THREE.Vector3().subVectors(P[9], P[0]).normalize();
    const bendSign = Math.sign(new THREE.Vector3().crossVectors(fingerAxis, lateral).dot(dorsal)) || 1;
    FINGERS.forEach((f, n) => this.placeNail(this.nails[n], P[f[2]], P[f[3]], radiusAt(f[3]), n, lateral, dorsal, bendSign));

    // 6. Palma y antebrazo
    this.buildPalm(lateral, dorsal);
    this.placeForearm(lateral, dorsal);
  }

  private placeNail(
    nail: THREE.Mesh,
    base: THREE.Vector3,
    tip: THREE.Vector3,
    r: number,
    finger: number,
    lateral: THREE.Vector3,
    dorsal: THREE.Vector3,
    bendSign: number,
  ) {
    const y = new THREE.Vector3().subVectors(tip, base);
    const len = y.length();
    nail.visible = len > 1e-4;
    if (!nail.visible) return;
    y.divideScalar(len);

    // Hacia dónde mira la uña. Los dedos se doblan alrededor del eje "lateral",
    // así que el dorso de la punta gira junto con el dedo.
    let z: THREE.Vector3;
    if (finger === 0) {
      // El pulgar mira hacia afuera y un poco hacia el dorso
      z = dorsal.clone().multiplyScalar(0.7).addScaledVector(lateral, 0.75);
    } else {
      z = new THREE.Vector3().crossVectors(y, lateral).multiplyScalar(bendSign);
      if (z.lengthSq() < 1e-4) z = dorsal.clone();
    }
    z.addScaledVector(y, -z.dot(y)).normalize(); // perpendicular al dedo
    const x = new THREE.Vector3().crossVectors(y, z).normalize();
    z.crossVectors(x, y); // base ordenada (derecha, arriba, frente)

    const pos = base.clone().lerp(tip, 0.6).addScaledVector(z, r * 0.84);
    nail.matrix
      .makeBasis(x, y, z)
      .scale(new THREE.Vector3(r * 0.74, len * 0.36, r * 0.22))
      .setPosition(pos);
  }

  /** Palma: envolvemos con una superficie varias "bolitas" aplanadas (muñeca, nudillos, base del pulgar…). */
  private buildPalm(lateral: THREE.Vector3, dorsal: THREE.Vector3) {
    const P = this.P;
    const palmSide = dorsal.clone().negate();
    const mix = (pts: [THREE.Vector3, number][]) =>
      pts.reduce((acc, [p, w]) => acc.addScaledVector(p, w), new THREE.Vector3());

    const back = new THREE.Vector3().subVectors(P[0], P[9]).normalize(); // hacia el codo

    // [centro, radio a lo ancho, radio a lo grueso]  (1 ≈ 9.5 cm)
    const centers: [THREE.Vector3, number, number][] = [
      // Muñeca: mismo ancho y grueso que el antebrazo, para que la unión no tenga escalón
      [P[0].clone().addScaledVector(back, 0.12), 0.3, 0.18],
      [P[0].clone().addScaledVector(lateral, 0.15), 0.15, 0.17], // muñeca, lado del pulgar
      [P[0].clone().addScaledVector(lateral, -0.15), 0.15, 0.16], // muñeca, lado del meñique
      [P[1].clone(), 0.14, 0.15], // base del pulgar
      [P[5].clone(), 0.118, 0.112], // nudillos
      [P[9].clone(), 0.12, 0.114],
      [P[13].clone(), 0.112, 0.106],
      [P[17].clone(), 0.098, 0.094],
      // Músculo de la base del pulgar (abultado hacia la palma)
      [mix([[P[0], 0.34], [P[1], 0.33], [P[5], 0.33]]).addScaledVector(palmSide, 0.05), 0.15, 0.13],
      // Borde del lado del meñique
      [mix([[P[0], 0.45], [P[17], 0.55]]).addScaledVector(lateral, -0.04).addScaledVector(palmSide, 0.03), 0.13, 0.13],
      // Centro de la palma
      [mix([[P[0], 0.5], [P[9], 0.5]]), 0.14, 0.14],
    ];

    // Puntos sobre cada bolita (aplanada en la dirección del grosor de la palma)
    const pts = this.hullPoints;
    let k = 0;
    for (const [c, wide, thick] of centers) {
      for (const d of DIRS) {
        const p = (pts[k] ??= new THREE.Vector3());
        const along = d.dot(dorsal);
        p.copy(d)
          .addScaledVector(dorsal, -along)
          .multiplyScalar(wide)
          .addScaledVector(dorsal, along * thick)
          .add(c);
        k++;
      }
    }

    // Superficie que envuelve todos los puntos, con sombreado suave
    const hull = new ConvexGeometry(pts.slice(0, k));
    hull.deleteAttribute('normal');
    const smooth = mergeVertices(hull, 1e-5);
    smooth.computeVertexNormals();
    hull.dispose();
    this.palm.geometry.dispose();
    this.palm.geometry = smooth;
  }

  /** Antebrazo: un tubo ovalado que sale de la muñeca, en dirección contraria a los dedos. */
  private placeForearm(lateral: THREE.Vector3, dorsal: THREE.Vector3) {
    const P = this.P;
    const back = new THREE.Vector3().subVectors(P[0], P[9]).normalize(); // de los dedos hacia el codo
    const length = 3.2;
    const y = back.clone().negate(); // el extremo "de arriba" del tubo (más delgado) queda en la muñeca
    const x = lateral.clone().addScaledVector(y, -lateral.dot(y)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    if (z.dot(dorsal) < 0) {
      // Que el lado plano del antebrazo coincida con el dorso de la mano
      x.negate();
      z.negate();
    }
    // Empieza un poco DENTRO de la muñeca para que no se vea la unión
    const center = P[0].clone().addScaledVector(back, length / 2 - 0.14);
    this.forearm.matrix.makeBasis(x, y, z).scale(new THREE.Vector3(0.3, length, 0.18)).setPosition(center);
  }

  // ---------- Girar la mano arrastrando ----------

  private onDown = (e: PointerEvent) => {
    this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId, mouse: e.pointerType === 'mouse' };
  };
  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // En celular, arrastrar hacia los lados gira la mano y hacia arriba/abajo mueve la página
    if (!d.mouse && Math.abs(dy) > Math.abs(dx) * 1.2 && Math.abs(dy) > 8) {
      this.drag = null;
      return;
    }
    if (Math.abs(dx) > 3) this.canvas.setPointerCapture?.(e.pointerId);
    this.targetYaw = THREE.MathUtils.clamp(this.targetYaw + dx * 0.012, -Math.PI, Math.PI);
    if (d.mouse) this.targetPitch = THREE.MathUtils.clamp(this.targetPitch + dy * 0.01, -1.2, 1.2);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  private onUp = () => {
    this.drag = null;
  };
  private onDouble = () => this.resetView();

  private listenToDrag() {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('dblclick', this.onDouble);
  }

  /** Libera la memoria de la tarjeta de video al salir de la pantalla. */
  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('dblclick', this.onDouble);
    this.hand.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.skin.dispose();
    this.nailMaterial.dispose();
    this.envTexture.dispose();
    this.renderer.dispose();
  }
}
