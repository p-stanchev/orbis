import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type CelestialBody = {
  azimuth_deg: number;
  elevation_deg: number;
  above_geometric_horizon: boolean;
  geometric_visibility?: "full" | "partial" | "hidden";
  geometric_visible_fraction?: number;
  angular_radius_deg?: number;
  terrain_horizon_deg?: number;
  terrain_visible_fraction?: number;
  terrain_visibility?: "full" | "partial" | "hidden";
};

export type Ephemeris = {
  time_utc: string;
  sun: CelestialBody;
  earth: CelestialBody;
  terrain_horizon_applied: boolean;
  terrain_coverage_min_km?: number;
  near_5m_used?: boolean;
};

export type TerrainPatch = {
  width_m: number;
  grid_size: number;
  elevation: (number | null)[];
  coverage_fraction: number;
  dataset: string;
  resolution?: string;
  north_rotation_deg?: number;
};

function bodyDirection(body: CelestialBody): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(body.azimuth_deg);
  const el = THREE.MathUtils.degToRad(body.elevation_deg);
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    -Math.cos(az) * Math.cos(el),
  );
}

function textSprite(label: string, color: string, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, 256, 64);
    context.font = "bold 28px Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = color;
    context.fillText(label, 128, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(9 * scale, 2.25 * scale, 1);
  return { sprite, material, texture };
}

function buildCircularTerrain(patch: TerrainPatch) {
  const n = patch.grid_size;
  const data = patch.elevation;
  if (n < 2 || data.length !== n * n) return null;

  const valid = data.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!valid.length) return null;
  const ordered = [...valid].sort((a, b) => a - b);
  const centerIndex = Math.floor(n / 2) * n + Math.floor(n / 2);
  const centerValue = data[centerIndex];
  if (centerValue === null || !Number.isFinite(centerValue)) return null;
  const centerElevation = centerValue;
  const radius = 10;
  const segments = 128;
  const rings = 45;
  const metersToScene = radius * 2 / Math.max(patch.width_m, 1);
  const exaggeration = 2;
  const lunarRadiusM = 1_737_400;

  function sample(x: number, z: number) {
    const col = THREE.MathUtils.clamp((x / (radius * 2) + 0.5) * (n - 1), 0, n - 1);
    const row = THREE.MathUtils.clamp((z / (radius * 2) + 0.5) * (n - 1), 0, n - 1);
    const c0 = Math.floor(col);
    const r0 = Math.floor(row);
    const c1 = Math.min(c0 + 1, n - 1);
    const r1 = Math.min(r0 + 1, n - 1);
    const tx = col - c0;
    const tz = row - r0;
    const values = [data[r0 * n + c0], data[r0 * n + c1], data[r1 * n + c0], data[r1 * n + c1]];
    const weights = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
    let sum = 0;
    let total = 0;
    for (let i = 0; i < 4; i++) {
      if (values[i] !== null && Number.isFinite(values[i])) {
        sum += (values[i] as number) * weights[i];
        total += weights[i];
      }
    }
    return total > 0 ? sum / total : null;
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const low = ordered[Math.floor(ordered.length * 0.05)];
  const high = ordered[Math.floor(ordered.length * 0.95)];
  const dark = new THREE.Color("#555b60");
  const light = new THREE.Color("#b2b9bc");
  const shaded = new THREE.Color();

  const validVertices: boolean[] = [];
  function addVertex(x: number, z: number) {
    const elevation = sample(x, z);
    if (elevation === null) {
      positions.push(x, 0, z);
      colors.push(0, 0, 0);
      validVertices.push(false);
      return;
    }
    const distanceMeters = Math.hypot(x, z) / metersToScene;
    const arc = distanceMeters / lunarRadiusM;
    const sphereSagMeters = (lunarRadiusM + centerElevation) * (Math.cos(arc) - 1);
    const y = (sphereSagMeters + (elevation - centerElevation) * Math.cos(arc) * exaggeration) * metersToScene;
    const radialScale = (lunarRadiusM + elevation) * Math.sin(arc) / (distanceMeters || 1);
    positions.push(distanceMeters ? x * radialScale : x, y, distanceMeters ? z * radialScale : z);
    const t = THREE.MathUtils.clamp((elevation - low) / Math.max(high - low, 1), 0, 1);
    shaded.copy(dark).lerp(light, t);
    colors.push(shaded.r, shaded.g, shaded.b);
    validVertices.push(true);
  }

  addVertex(0, 0);
  for (let ring = 1; ring <= rings; ring++) {
    const r = radius * ring / rings;
    for (let segment = 0; segment < segments; segment++) {
      const angle = 2 * Math.PI * segment / segments;
      addVertex(Math.cos(angle) * r, Math.sin(angle) * r);
    }
  }

  for (let segment = 0; segment < segments; segment++) {
    const a = 1 + (segment + 1) % segments;
    const b = 1 + segment;
    if (validVertices[a] && validVertices[b]) indices.push(0, a, b);
  }
  for (let ring = 1; ring < rings; ring++) {
    const inner = 1 + (ring - 1) * segments;
    const outer = inner + segments;
    for (let segment = 0; segment < segments; segment++) {
      const next = (segment + 1) % segments;
      const a = inner + segment;
      const b = inner + next;
      const c = outer + segment;
      const d = outer + next;
      if (validVertices[a] && validVertices[b] && validVertices[c]) indices.push(a, b, c);
      if (validVertices[b] && validVertices[d] && validVertices[c]) indices.push(b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export default function TerrainScene({
  patch,
  ephemeris,
  siteLabel,
}: {
  patch: TerrainPatch | null;
  ephemeris: Ephemeris | null;
  siteLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<"inspection" | "surface">("inspection");
  const objects = useRef<{
    sun: THREE.Mesh;
    earth: THREE.Mesh;
    sunLabel: THREE.Sprite;
    earthLabel: THREE.Sprite;
    sunlight: THREE.DirectionalLight;
  } | null>(null);

  useEffect(() => {
    const parent = container.current;
    if (!parent) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#10151b");
    const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 500);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    parent.insertBefore(renderer.domElement, parent.firstChild);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.minDistance = viewMode === "surface" ? 0.7 : 4;
    controls.maxDistance = 45;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    controls.zoomSpeed = 0.85;
    controls.panSpeed = 0.9;

    let surface: THREE.Mesh | null = null;
    let inspectionFloor = 0.4;
    const initialTarget = viewMode === "surface" ? new THREE.Vector3(0, 0.8, -5) : new THREE.Vector3(0, 0, 0);
    const initialOffset = viewMode === "surface" ? new THREE.Vector3(0, 0.45, 5) : new THREE.Vector3(7, 8, 13);
    const reset = () => {
      controls.target.copy(initialTarget);
      camera.position.copy(initialTarget).add(initialOffset);
      controls.update();
    };
    reset();
    const faceSun = (event: Event) => {
      const direction = (event as CustomEvent<{ azimuth: number }>).detail;
      if (!direction) return;
      const az = THREE.MathUtils.degToRad(direction.azimuth);
      if (viewMode === "surface") {
        controls.target.set(Math.sin(az) * 5, 0.8, -Math.cos(az) * 5);
        camera.position.set(0, 1.25, 0);
      } else {
        controls.target.set(0, 0, 0);
        camera.position.set(-Math.sin(az) * 13, 8, Math.cos(az) * 13);
      }
      controls.update();
    };

    const ambient = new THREE.HemisphereLight("#d4e0e8", "#45515b", 1.25);
    scene.add(ambient);
    const sunlight = new THREE.DirectionalLight("#fff4d8", 2.5);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(1024, 1024);
    sunlight.shadow.camera.left = -12;
    sunlight.shadow.camera.right = 12;
    sunlight.shadow.camera.top = 12;
    sunlight.shadow.camera.bottom = -12;
    sunlight.shadow.camera.near = 0.1;
    sunlight.shadow.camera.far = 100;
    sunlight.shadow.bias = -0.0003;
    sunlight.target.position.set(0, 0, 0);
    scene.add(sunlight, sunlight.target);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];

    if (patch) {
      const geometry = buildCircularTerrain(patch);
      if (geometry) {
        const material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          metalness: 0,
          side: THREE.DoubleSide,
        });
        geometry.computeBoundingBox();
        inspectionFloor = Math.max(0.4, (geometry.boundingBox?.max.y ?? 0) + 0.5);
        surface = new THREE.Mesh(geometry, material);
        surface.rotation.y = THREE.MathUtils.degToRad(patch.north_rotation_deg ?? 0);
        surface.receiveShadow = true;
        surface.castShadow = true;
        scene.add(surface);
        geometries.push(geometry);
        materials.push(material);

        const pinGeometry = new THREE.SphereGeometry(0.15, 20, 16);
        const pinMaterial = new THREE.MeshBasicMaterial({ color: "#ff9900" });
        const pin = new THREE.Mesh(pinGeometry, pinMaterial);
        pin.position.set(0, 0.17, 0);
        scene.add(pin);
        geometries.push(pinGeometry);
        materials.push(pinMaterial);

        const label = textSprite(siteLabel.toUpperCase().slice(0, 24), "#ffffff", 0.32);
        label.sprite.position.set(0, 0.95, 0);
        label.material.depthTest = true;
        scene.add(label.sprite);
        materials.push(label.material);
        textures.push(label.texture);
      }
    }

    const sunGeometry = new THREE.SphereGeometry(0.75, 32, 20);
    const earthGeometry = new THREE.SphereGeometry(2.65, 32, 20);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: "#ffb330", toneMapped: false });
    const earthMaterial = new THREE.MeshBasicMaterial({ color: "#03ace4", toneMapped: false });
    const sun = new THREE.Mesh(sunGeometry, sunMaterial);
    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    sun.visible = false;
    earth.visible = false;

    const sky = new THREE.Group();
    scene.add(sky);
    sky.add(sun, earth);
    geometries.push(sunGeometry, earthGeometry);
    materials.push(sunMaterial, earthMaterial);

    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = glowCanvas.height = 128;
    const glowContext = glowCanvas.getContext("2d");
    if (glowContext) {
      const gradient = glowContext.createRadialGradient(64, 64, 3, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255,180,60,0.75)");
      gradient.addColorStop(0.22, "rgba(255,168,32,0.25)");
      gradient.addColorStop(1, "rgba(255,168,32,0)");
      glowContext.fillStyle = gradient;
      glowContext.fillRect(0, 0, 128, 128);
    }
    const glowTexture = new THREE.CanvasTexture(glowCanvas);
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture, transparent: true, depthWrite: false, depthTest: false,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.set(19, 19, 1);
    sun.add(glow);
    textures.push(glowTexture);
    materials.push(glowMaterial);

    const sunLabel = textSprite("SUN", "#ffb330", 0.8);
    const earthLabel = textSprite("EARTH", "#64cdf1", 0.8);
    sky.add(sunLabel.sprite, earthLabel.sprite);
    materials.push(sunLabel.material, earthLabel.material);
    textures.push(sunLabel.texture, earthLabel.texture);
    objects.current = {
      sun, earth, sunLabel: sunLabel.sprite, earthLabel: earthLabel.sprite, sunlight,
    };

    const raycaster = new THREE.Raycaster();
    const groundAt = (x: number, z: number) => {
      if (!surface) return 0;
      raycaster.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      return raycaster.intersectObject(surface, false)[0]?.point.y ?? 0;
    };
    const boundPan = () => {
      const targetHeight = viewMode === "surface" ? 0.8 : 0;
      const heightShift = targetHeight - controls.target.y;
      controls.target.y += heightShift;
      camera.position.y += heightShift;
      const displacement = controls.target.clone();
      displacement.y = 0;
      const distance = displacement.length();
      const limit = viewMode === "surface" ? 7 : 5;
      if (distance > limit) {
        const correction = displacement.multiplyScalar((distance - limit) / distance);
        controls.target.sub(correction);
        camera.position.sub(correction);
      }
      const floor = viewMode === "surface"
        ? groundAt(camera.position.x, camera.position.z) + 0.55
        : inspectionFloor;
      if (camera.position.y < floor) camera.position.y = floor;
    };

    const shiftPan = (event: PointerEvent) => {
      controls.mouseButtons.LEFT = event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    const restoreOrbit = () => { controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE; };
    renderer.domElement.addEventListener("pointerdown", shiftPan, true);
    window.addEventListener("pointerup", restoreOrbit);
    window.addEventListener("pointercancel", restoreOrbit);

    const resize = () => {
      const width = Math.max(1, parent.clientWidth);
      const height = Math.max(1, parent.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      boundPan();
      camera.lookAt(controls.target);
      sky.position.copy(camera.position);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();
    parent.addEventListener("orbis-reset-view", reset);
    parent.addEventListener("orbis-face-sun", faceSun);

    return () => {
      cancelAnimationFrame(frame);
      parent.removeEventListener("orbis-reset-view", reset);
      parent.removeEventListener("orbis-face-sun", faceSun);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", shiftPan, true);
      window.removeEventListener("pointerup", restoreOrbit);
      window.removeEventListener("pointercancel", restoreOrbit);
      controls.dispose();
      objects.current = null;
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [patch, siteLabel, viewMode]);

  useEffect(() => {
    const current = objects.current;
    if (!current) return;
    const visible = ephemeris !== null;
    current.sun.visible = visible && ephemeris!.sun.terrain_visibility !== "hidden";
    current.earth.visible = visible && ephemeris!.earth.terrain_visibility !== "hidden";
    current.sunLabel.visible = current.sun.visible;
    current.earthLabel.visible = current.earth.visible;
    if (!ephemeris) {
      current.sunlight.intensity = 0;
      return;
    }

    const sunDir = bodyDirection(ephemeris.sun);
    const earthDir = bodyDirection(ephemeris.earth);
    current.sun.position.copy(sunDir).multiplyScalar(160);
    current.earth.position.copy(earthDir).multiplyScalar(160);
    current.sunLabel.position.copy(sunDir).multiplyScalar(160).add(new THREE.Vector3(0, 7, 0));
    current.earthLabel.position.copy(earthDir).multiplyScalar(160).add(new THREE.Vector3(0, 6, 0));
    current.sunlight.position.copy(sunDir).multiplyScalar(45);
    current.sunlight.intensity = 2.5 * (ephemeris.sun.terrain_visible_fraction ?? 0);
  }, [ephemeris, patch, viewMode]);

  return (
    <div ref={container} className="relative h-full min-h-0 w-full overflow-hidden">
      <span className="pointer-events-none absolute bottom-2 left-2 z-10 hidden max-w-[85%] bg-[#171b20]/90 px-2 py-1 text-[10px] text-[#d0d0d0] sm:block">
        Orbit: drag | Pan: Shift+drag or right drag | Zoom: wheel | 2x vertical relief
      </span>
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <button type="button" className="bg-[#30363d] px-2 py-1 text-[11px] text-white hover:bg-[#46505a]" onClick={() => setViewMode(mode => mode === "inspection" ? "surface" : "inspection")}>{viewMode === "inspection" ? "Surface view" : "Inspection view"}</button>
        {ephemeris && <button type="button" className="bg-[#30363d] px-2 py-1 text-[11px] text-white hover:bg-[#46505a]"
          onClick={() => container.current?.dispatchEvent(new CustomEvent("orbis-face-sun", {
            detail: { azimuth: ephemeris.sun.azimuth_deg },
          }))}>Face Sun</button>}
        <button type="button" className="bg-[#30363d] px-2 py-1 text-[11px] text-white hover:bg-[#46505a]"
          onClick={() => container.current?.dispatchEvent(new Event("orbis-reset-view"))}>Reset view</button>
      </div>
      {ephemeris && <span className="pointer-events-none absolute right-2 top-10 z-10 bg-[#171b20]/90 px-2 py-1 text-[10px] text-[#d0d0d0]">
        Sun {ephemeris.sun.terrain_visibility === "hidden" ? ephemeris.sun.geometric_visibility === "hidden" ? "below geometric horizon" : "blocked by terrain" : `${ephemeris.sun.elevation_deg.toFixed(1)}° above local level`}
      </span>}
      {!patch && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%] bg-[#292929] px-2 py-1 text-[11px] text-[#ddd]">
          Awaiting local DEM terrain
        </div>
      )}
    </div>
  );
}
