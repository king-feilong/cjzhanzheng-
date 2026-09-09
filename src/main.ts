import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import "./style.css";

/* ------------------------------------------------------------------ */
/*  第三步：场景 / 相机 / 渲染器 / 灯光 / 地面 / 掩体                  */
/* ------------------------------------------------------------------ */

const container = document.getElementById("scene-container") as HTMLDivElement;

// 场地边界（正方形阵地，边长 = ARENA_SIZE）
const ARENA_SIZE = 100;
const ARENA_HALF = ARENA_SIZE / 2;

// --- 场景 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

// --- 相机 ---
const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 1.7, 10); // 1.7 约等于人眼高度
camera.rotation.order = "YXZ"; // 与 PointerLockControls 内部欧拉角顺序保持一致，便于统一取 yaw/pitch

// --- 渲染器 ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

// --- 灯光 ---
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445566, 0.9);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
sunLight.position.set(40, 60, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -ARENA_HALF - 10;
sunLight.shadow.camera.right = ARENA_HALF + 10;
sunLight.shadow.camera.top = ARENA_HALF + 10;
sunLight.shadow.camera.bottom = -ARENA_HALF - 10;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 150;
scene.add(sunLight);

// --- 地面（网格纹理 + 大网格线辅助） ---
const groundGeometry = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE);
const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x4a7c3f,
  roughness: 0.9,
  metalness: 0.0,
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(ARENA_SIZE, 40, 0x223311, 0x335522);
(gridHelper.material as THREE.Material).opacity = 0.35;
(gridHelper.material as THREE.Material).transparent = true;
scene.add(gridHelper);

// --- 场地边界墙（防止玩家/视觉上跑出场地） ---
type Obstacle = {
  mesh: THREE.Mesh;
  box: THREE.Box3;
};

const obstacles: Obstacle[] = [];

function addObstacle(
  width: number,
  height: number,
  depth: number,
  x: number,
  z: number,
  color: number,
) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const box = new THREE.Box3().setFromObject(mesh);
  obstacles.push({ mesh, box });
  return mesh;
}

// 四周边界墙
const WALL_THICKNESS = 2;
const WALL_HEIGHT = 6;
addObstacle(ARENA_SIZE + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS, 0, -ARENA_HALF, 0x555555);
addObstacle(ARENA_SIZE + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS, 0, ARENA_HALF, 0x555555);
addObstacle(WALL_THICKNESS, WALL_HEIGHT, ARENA_SIZE, -ARENA_HALF, 0, 0x555555);
addObstacle(WALL_THICKNESS, WALL_HEIGHT, ARENA_SIZE, ARENA_HALF, 0, 0x555555);

// 场地内随机分布掩体（箱子 / 矮墙）
function randomRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

const COVER_COLORS = [0x8b5a2b, 0x8a8a8a, 0x6b4f2a, 0x9c9c9c];
const SAFE_ZONE_RADIUS = 6; // 出生点附近留空

for (let i = 0; i < 24; i++) {
  let x = 0;
  let z = 0;
  // 避免掩体生成在出生点附近或紧贴边界
  do {
    x = randomRange(-ARENA_HALF + 6, ARENA_HALF - 6);
    z = randomRange(-ARENA_HALF + 6, ARENA_HALF - 6);
  } while (Math.hypot(x, z - 10) < SAFE_ZONE_RADIUS);

  const isWall = Math.random() > 0.5;
  const width = isWall ? randomRange(4, 8) : randomRange(1.5, 3);
  const height = isWall ? randomRange(1.5, 2.5) : randomRange(1, 2.2);
  const depth = isWall ? randomRange(0.6, 1) : randomRange(1.5, 3);
  const color = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];

  const mesh = addObstacle(width, height, depth, x, z, color);
  mesh.rotation.y = randomRange(0, Math.PI);
  // 旋转后需要重新计算包围盒
  const box = new THREE.Box3().setFromObject(mesh);
  const found = obstacles.find((o) => o.mesh === mesh);
  if (found) found.box = box;
}

/* ------------------------------------------------------------------ */
/*  第四步：第一人称控制 + WASD 移动 + 简单碰撞检测                    */
/* ------------------------------------------------------------------ */

const PLAYER_RADIUS = 0.4;
const MOVE_SPEED = 6; // 米/秒
const EYE_HEIGHT = 1.7;

// 触屏设备检测
const isTouchDevice =
  "ontouchstart" in window ||
  navigator.maxTouchPoints > 0 ||
  window.matchMedia("(pointer: coarse)").matches;

if (isTouchDevice) {
  document.body.classList.add("is-touch");
}

// --- 桌面端：PointerLockControls ---
const controls = new PointerLockControls(camera, document.body);

// --- DOM 元素引用 ---
const startOverlay = document.getElementById("start-overlay") as HTMLDivElement;
const startButton = document.getElementById("start-button") as HTMLButtonElement;
const crosshair = document.getElementById("crosshair") as HTMLDivElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const mobileControls = document.getElementById("mobile-controls") as HTMLDivElement;
const scoreEl = document.getElementById("score") as HTMLDivElement;
const ammoInfo = document.getElementById("ammo-info") as HTMLDivElement;
const timeInfo = document.getElementById("time-info") as HTMLDivElement;
const endScreen = document.getElementById("end-screen") as HTMLDivElement;
const finalScoreEl = document.getElementById("final-score") as HTMLDivElement;
const restartButton = document.getElementById("restart-button") as HTMLButtonElement;

let gameActive = false;
let score = 0;

// 移动端：尝试请求全屏 + 锁定横屏（部分浏览器不支持，静默失败即可，
// 竖屏时仍有 #rotate-hint 的 CSS 兜底提示）
function tryLockLandscape() {
  if (!isTouchDevice) return;
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {});
    }
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    if (orientation && orientation.lock) {
      orientation.lock("landscape").catch(() => {});
    }
  } catch {
    // 忽略不支持的浏览器
  }
}

function enterGame() {
  gameActive = true;
  startOverlay.classList.add("hidden");
  crosshair.classList.add("visible");
  hud.classList.add("visible");
  if (isTouchDevice) {
    mobileControls.classList.remove("hidden");
  }
}

function exitGame() {
  gameActive = false;
  crosshair.classList.remove("visible");
  hud.classList.remove("visible");
  mobileControls.classList.add("hidden");
  // 回合已结束时不要把开始遮罩重新盖回结算页上面
  if (endScreen.classList.contains("hidden")) {
    startOverlay.classList.remove("hidden");
  }
}

startButton.addEventListener("click", () => {
  ensureAudio();
  tryLockLandscape();
  if (isTouchDevice) {
    enterGame();
  } else {
    controls.lock();
  }
});

// 点击场景（非按钮区域）时若尚未开始，也允许直接锁定鼠标（桌面）
startOverlay.addEventListener("click", (e) => {
  if (isTouchDevice) return;
  if (e.target === startButton) return;
  ensureAudio();
  controls.lock();
});

controls.addEventListener("lock", enterGame);
controls.addEventListener("unlock", exitGame);

/* ---------------- 桌面端键盘输入 ---------------- */
const keyState: Record<string, boolean> = {};

window.addEventListener("keydown", (e) => {
  keyState[e.code] = true;
});
window.addEventListener("keyup", (e) => {
  keyState[e.code] = false;
});

/* ---------------- 移动端虚拟摇杆（移动） ---------------- */
const joystickZone = document.getElementById("joystick-zone") as HTMLDivElement;
const joystickBase = document.getElementById("joystick-base") as HTMLDivElement;
const joystickKnob = document.getElementById("joystick-knob") as HTMLDivElement;

const joystickInput = { x: 0, y: 0 }; // x: 左右(-1~1)，y: 前后(-1~1，负值=前进)
let joystickTouchId: number | null = null;
const JOYSTICK_MAX_RADIUS = 46;

function updateJoystickFromTouch(touch: Touch) {
  const rect = joystickBase.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  let dx = touch.clientX - centerX;
  let dy = touch.clientY - centerY;
  const dist = Math.hypot(dx, dy);
  if (dist > JOYSTICK_MAX_RADIUS) {
    dx = (dx / dist) * JOYSTICK_MAX_RADIUS;
    dy = (dy / dist) * JOYSTICK_MAX_RADIUS;
  }
  joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  joystickInput.x = dx / JOYSTICK_MAX_RADIUS;
  joystickInput.y = dy / JOYSTICK_MAX_RADIUS;
}

function resetJoystick() {
  joystickTouchId = null;
  joystickInput.x = 0;
  joystickInput.y = 0;
  joystickKnob.style.transform = "translate(0px, 0px)";
}

joystickZone.addEventListener(
  "touchstart",
  (e) => {
    if (joystickTouchId !== null) return;
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    updateJoystickFromTouch(touch);
    e.preventDefault();
  },
  { passive: false },
);

joystickZone.addEventListener(
  "touchmove",
  (e) => {
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === joystickTouchId) {
        updateJoystickFromTouch(touch);
      }
    }
    e.preventDefault();
  },
  { passive: false },
);

function handleJoystickEnd(e: TouchEvent) {
  for (const touch of Array.from(e.changedTouches)) {
    if (touch.identifier === joystickTouchId) {
      resetJoystick();
    }
  }
}
joystickZone.addEventListener("touchend", handleJoystickEnd);
joystickZone.addEventListener("touchcancel", handleJoystickEnd);

/* ---------------- 移动端滑动视角（看方向） ---------------- */
const lookZone = document.getElementById("look-zone") as HTMLDivElement;
let lookTouchId: number | null = null;
let lastLookX = 0;
let lastLookY = 0;

let yaw = 0;
let pitch = 0;
const TOUCH_LOOK_SENSITIVITY = 0.0045;
const PITCH_LIMIT = Math.PI / 2 - 0.05;

lookZone.addEventListener(
  "touchstart",
  (e) => {
    if (lookTouchId !== null) return;
    const touch = e.changedTouches[0];
    lookTouchId = touch.identifier;
    lastLookX = touch.clientX;
    lastLookY = touch.clientY;
    e.preventDefault();
  },
  { passive: false },
);

lookZone.addEventListener(
  "touchmove",
  (e) => {
    for (const touch of Array.from(e.changedTouches)) {
      if (touch.identifier === lookTouchId) {
        const dx = touch.clientX - lastLookX;
        const dy = touch.clientY - lastLookY;
        lastLookX = touch.clientX;
        lastLookY = touch.clientY;
        yaw -= dx * TOUCH_LOOK_SENSITIVITY;
        pitch -= dy * TOUCH_LOOK_SENSITIVITY;
        pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
      }
    }
    e.preventDefault();
  },
  { passive: false },
);

function handleLookEnd(e: TouchEvent) {
  for (const touch of Array.from(e.changedTouches)) {
    if (touch.identifier === lookTouchId) {
      lookTouchId = null;
    }
  }
}
lookZone.addEventListener("touchend", handleLookEnd);
lookZone.addEventListener("touchcancel", handleLookEnd);

/* ---------------- 碰撞检测（简单 AABB + 圆形半径） ---------------- */
function isPositionClear(x: number, z: number, radius: number): boolean {
  for (const obs of obstacles) {
    const box = obs.box;
    if (
      x > box.min.x - radius &&
      x < box.max.x + radius &&
      z > box.min.z - radius &&
      z < box.max.z + radius
    ) {
      return false;
    }
  }
  return true;
}

function canMoveTo(x: number, z: number): boolean {
  return isPositionClear(x, z, PLAYER_RADIUS);
}

function attemptMove(dx: number, dz: number) {
  const curX = camera.position.x;
  const curZ = camera.position.z;

  const newX = curX + dx;
  if (canMoveTo(newX, curZ)) {
    camera.position.x = newX;
  }

  const newZ = camera.position.z + dz;
  if (canMoveTo(camera.position.x, newZ)) {
    camera.position.z = newZ;
  }
}

/* ---------------- 每帧更新移动 + 视角 ---------------- */
function updateMovement(delta: number) {
  if (!gameActive) return;

  let forwardInput = 0;
  let rightInput = 0;

  if (isTouchDevice) {
    forwardInput = -joystickInput.y;
    rightInput = joystickInput.x;

    // 移动端使用手动累积的 yaw/pitch 更新相机朝向
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  } else {
    if (keyState["KeyW"] || keyState["ArrowUp"]) forwardInput += 1;
    if (keyState["KeyS"] || keyState["ArrowDown"]) forwardInput -= 1;
    if (keyState["KeyD"] || keyState["ArrowRight"]) rightInput += 1;
    if (keyState["KeyA"] || keyState["ArrowLeft"]) rightInput -= 1;
  }

  const inputLength = Math.hypot(forwardInput, rightInput);
  if (inputLength > 1) {
    forwardInput /= inputLength;
    rightInput /= inputLength;
  }

  if (inputLength > 0.001) {
    const cameraYaw = camera.rotation.y;
    const forwardX = -Math.sin(cameraYaw);
    const forwardZ = -Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);

    const moveX = (forwardX * forwardInput + rightX * rightInput) * MOVE_SPEED * delta;
    const moveZ = (forwardZ * forwardInput + rightZ * rightInput) * MOVE_SPEED * delta;

    attemptMove(moveX, moveZ);
  }

  // 视点高度（含跑动起伏）由 updateMovementFeel 统一设置
  updateMovementFeel(delta, inputLength);
}

/* ------------------------------------------------------------------ */
/*  第五步：敌人靶子 + Raycaster 射击 + 分数                           */
/* ------------------------------------------------------------------ */

type EnemyTarget = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  alive: boolean;
};

const ENEMY_COUNT = 8;
const ENEMY_WIDTH = 0.7;
const ENEMY_HEIGHT = 1.6;
const ENEMY_DEPTH = 0.6;
const ENEMY_RADIUS = 0.6;
const ENEMY_COLOR = 0xff2222;
const ENEMY_HIT_COLOR = 0x33ff55;

const enemies: EnemyTarget[] = [];

function findEnemyPosition(): { x: number; z: number } {
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = randomRange(-ARENA_HALF + 5, ARENA_HALF - 5);
    const z = randomRange(-ARENA_HALF + 5, ARENA_HALF - 5);
    if (Math.hypot(x, z - 10) < SAFE_ZONE_RADIUS) continue; // 远离玩家出生点
    if (isPositionClear(x, z, ENEMY_RADIUS)) {
      return { x, z };
    }
  }
  return { x: 0, z: -ARENA_HALF + 8 };
}

function createEnemy(): EnemyTarget {
  const geometry = new THREE.BoxGeometry(ENEMY_WIDTH, ENEMY_HEIGHT, ENEMY_DEPTH);
  const material = new THREE.MeshStandardMaterial({ color: ENEMY_COLOR, roughness: 0.6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const pos = findEnemyPosition();
  mesh.position.set(pos.x, ENEMY_HEIGHT / 2, pos.z);
  scene.add(mesh);

  return { mesh, material, alive: true };
}

for (let i = 0; i < ENEMY_COUNT; i++) {
  enemies.push(createEnemy());
}

function updateTargetInfo() {
  const aliveCount = enemies.filter((e) => e.alive).length;
  ammoInfo.textContent = `存活目标: ${aliveCount} / ${ENEMY_COUNT}`;
}
updateTargetInfo();

const RESPAWN_MIN_DELAY = 900;
const RESPAWN_MAX_DELAY = 2200;
const HIT_FLASH_DURATION = 250;

function onEnemyHit(enemy: EnemyTarget) {
  if (!enemy.alive) return;
  enemy.alive = false;

  score += 1;
  scoreEl.textContent = `击杀: ${score}`;
  enemy.material.color.set(ENEMY_HIT_COLOR);
  updateTargetInfo();

  setTimeout(() => {
    enemy.mesh.visible = false;

    const respawnDelay = randomRange(RESPAWN_MIN_DELAY, RESPAWN_MAX_DELAY);
    setTimeout(() => {
      const pos = findEnemyPosition();
      enemy.mesh.position.x = pos.x;
      enemy.mesh.position.z = pos.z;
      enemy.material.color.set(ENEMY_COLOR);
      enemy.mesh.visible = true;
      enemy.alive = true;
      updateTargetInfo();
    }, respawnDelay);
  }, HIT_FLASH_DURATION);
}

/* ---------------- Raycaster 射击 ---------------- */
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
const FIRE_COOLDOWN_MS = 200;
let lastFireTime = 0;

function shoot() {
  if (!gameActive) return;
  const now = performance.now();
  if (now - lastFireTime < FIRE_COOLDOWN_MS) return;
  lastFireTime = now;

  playShot();
  spawnMuzzleFlash();
  flashCrosshair();

  raycaster.setFromCamera(screenCenter, camera);

  const shootTargets: THREE.Object3D[] = [
    ...obstacles.map((o) => o.mesh),
    ...enemies.filter((e) => e.alive).map((e) => e.mesh),
  ];

  const hits = raycaster.intersectObjects(shootTargets, false);

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const muzzlePoint = camera.position
    .clone()
    .add(forward.clone().multiplyScalar(0.4))
    .add(new THREE.Vector3(0, -0.1, 0));
  const tracerEnd = hits.length > 0 ? hits[0].point : camera.position.clone().add(forward.clone().multiplyScalar(80));
  spawnTracer(muzzlePoint, tracerEnd);

  if (hits.length === 0) return;

  const hitObject = hits[0].object;
  const hitEnemy = enemies.find((e) => e.mesh === hitObject);
  if (hitEnemy) {
    onEnemyHit(hitEnemy);
    playHit();
    spawnHitSpark(hits[0].point);
  }
  // 命中掩体/墙体则视为被掩体挡住，不做任何处理（子弹被挡）
}

// 桌面端：鼠标左键射击（仅在指针锁定时生效）
document.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (isTouchDevice) return;
  if (!controls.isLocked) return;
  shoot();
});

// 移动端：FIRE 按钮射击
const fireButton = document.getElementById("fire-button") as HTMLButtonElement;
fireButton.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    shoot();
  },
  { passive: false },
);

/* ------------------------------------------------------------------ */
/*  第六步：音效 / 移动反馈 / 限时结束 / 射击特效                       */
/* ------------------------------------------------------------------ */

/* ---------------- Web Audio 合成音效（无需外部音频文件） ---------------- */
let audioCtx: AudioContext | null = null;

function ensureAudio(): AudioContext {
  if (!audioCtx) {
    const AudioCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioCtor();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playShot() {
  const ctx = ensureAudio();
  const now = ctx.currentTime;

  // 白噪声枪声主体
  const noiseDuration = 0.12;
  const bufferSize = Math.floor(ctx.sampleRate * noiseDuration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 1200;
  bandpass.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.5, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDuration);
  noise.connect(bandpass).connect(noiseGain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + noiseDuration + 0.01);

  // 低频 "砰" 补充枪声厚度
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(48, now + 0.08);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.4, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

function playHit() {
  const ctx = ensureAudio();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.22, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.13);
}

function playFootstep() {
  const ctx = ensureAudio();
  const now = ctx.currentTime;
  const duration = 0.06;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 350;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.16, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  noise.connect(lowpass).connect(gain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + duration + 0.01);
}

/* ---------------- 射击特效：枪口闪光 / 弹道 / 命中火花 ---------------- */
type TransientEffect = {
  obj: THREE.Object3D;
  start: number;
  duration: number;
  update: (t: number) => void;
  dispose?: () => void;
};

const effects: TransientEffect[] = [];

function spawnMuzzleFlash() {
  const light = new THREE.PointLight(0xffdd88, 3, 6);
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  light.position
    .copy(camera.position)
    .add(forward.multiplyScalar(0.4))
    .add(new THREE.Vector3(0, -0.1, 0));
  scene.add(light);
  effects.push({
    obj: light,
    start: performance.now(),
    duration: 60,
    update(t) {
      light.intensity = 3 * (1 - t);
    },
  });
}

function spawnTracer(from: THREE.Vector3, to: THREE.Vector3) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({
    color: 0xfff2c2,
    transparent: true,
    opacity: 0.9,
  });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  effects.push({
    obj: line,
    start: performance.now(),
    duration: 90,
    update(t) {
      material.opacity = 0.9 * (1 - t);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  });
}

function spawnHitSpark(position: THREE.Vector3) {
  const geometry = new THREE.SphereGeometry(0.07, 6, 6);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffcf6b,
    transparent: true,
    opacity: 1,
  });
  const spark = new THREE.Mesh(geometry, material);
  spark.position.copy(position);
  scene.add(spark);
  effects.push({
    obj: spark,
    start: performance.now(),
    duration: 220,
    update(t) {
      spark.scale.setScalar(1 + t * 4);
      material.opacity = 1 - t;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  });
}

function updateEffects() {
  const now = performance.now();
  for (let i = effects.length - 1; i >= 0; i--) {
    const eff = effects[i];
    const t = (now - eff.start) / eff.duration;
    if (t >= 1) {
      scene.remove(eff.obj);
      eff.dispose?.();
      effects.splice(i, 1);
    } else {
      eff.update(Math.min(t, 1));
    }
  }
}

// 准星开火闪白反馈
let crosshairFlashTimeout: number | undefined;
function flashCrosshair() {
  crosshair.classList.add("firing");
  window.clearTimeout(crosshairFlashTimeout);
  crosshairFlashTimeout = window.setTimeout(() => {
    crosshair.classList.remove("firing");
  }, 90);
}

/* ---------------- 移动反馈：视角起伏 + 轻微摇摆 + FOV ---------------- */
const BASE_FOV = 75;
const RUN_FOV = 80;
const BOB_FREQUENCY = 9;
const BOB_AMPLITUDE = 0.045;
const BOB_ROLL_AMPLITUDE = 0.014;
const FOOTSTEP_INTERVAL = 0.32;

let bobTime = 0;
let footstepTimer = 0;

function updateMovementFeel(delta: number, moveInputLength: number) {
  const isMoving = moveInputLength > 0.05;

  if (isMoving) {
    bobTime += delta * BOB_FREQUENCY * Math.max(moveInputLength, 0.4);
    footstepTimer += delta;
    if (footstepTimer >= FOOTSTEP_INTERVAL) {
      footstepTimer = 0;
      playFootstep();
    }
  } else {
    footstepTimer = 0;
  }

  const bobOffset = isMoving ? Math.sin(bobTime) * BOB_AMPLITUDE : 0;
  const bobRoll = isMoving ? Math.sin(bobTime) * BOB_ROLL_AMPLITUDE : 0;
  camera.position.y = EYE_HEIGHT + bobOffset;
  camera.rotation.z = bobRoll;

  const targetFov = isMoving ? RUN_FOV : BASE_FOV;
  const nextFov = camera.fov + (targetFov - camera.fov) * Math.min(delta * 6, 1);
  if (Math.abs(nextFov - camera.fov) > 0.01) {
    camera.fov = nextFov;
    camera.updateProjectionMatrix();
  }
}

/* ---------------- 限时结束机制 ---------------- */
const ROUND_SECONDS = 60;
let timeRemaining = ROUND_SECONDS;

function updateTimeUI() {
  timeInfo.textContent = `剩余时间: ${Math.max(0, Math.ceil(timeRemaining))}s`;
}
updateTimeUI();

function endRound() {
  gameActive = false;
  crosshair.classList.remove("visible");
  hud.classList.remove("visible");
  mobileControls.classList.add("hidden");
  finalScoreEl.textContent = String(score);
  endScreen.classList.remove("hidden");
  if (!isTouchDevice && controls.isLocked) {
    controls.unlock();
  }
}

function resetRound() {
  score = 0;
  scoreEl.textContent = "击杀: 0";
  timeRemaining = ROUND_SECONDS;
  updateTimeUI();
  endScreen.classList.add("hidden");
}

function updateRoundTimer(delta: number) {
  if (!gameActive) return;
  timeRemaining -= delta;
  if (timeRemaining <= 0) {
    timeRemaining = 0;
    updateTimeUI();
    endRound();
    return;
  }
  updateTimeUI();
}

restartButton.addEventListener("click", () => {
  ensureAudio();
  resetRound();
  tryLockLandscape();
  if (isTouchDevice) {
    enterGame();
  } else {
    controls.lock();
  }
});

/* ------------------------------------------------------------------ */
/*  渲染循环 + 窗口自适应                                              */
/* ------------------------------------------------------------------ */

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onWindowResize);

let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  updateMovement(delta);
  updateRoundTimer(delta);
  updateEffects();
  renderer.render(scene, camera);
}
animate();
