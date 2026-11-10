type Point = { x: number; y: number };
type Fish = Point & { vx: number; vy: number; phase: number; alarm: number; depth: number };
type SharkKind = 'reef' | 'hammerhead' | 'thresher';
type Shark = Point & { heading: number; speed: number; phase: number; length: number; turn: number; kind: SharkKind };
type Ripple = Point & { age: number };
type Triangle = [Point, Point, Point];
type Sample = { shade: number; fin: boolean; eye: boolean };

const TAU = Math.PI * 2;
const STEP = 1 / 60;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const angleDifference = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const wrap = (value: number, size: number) => ((value + 24) % (size + 48) + size + 48) % (size + 48) - 24;

function inTriangle(point: Point, [a, b, c]: Triangle) {
  const ab = (point.x - b.x) * (a.y - b.y) - (a.x - b.x) * (point.y - b.y);
  const bc = (point.x - c.x) * (b.y - c.y) - (b.x - c.x) * (point.y - c.y);
  const ca = (point.x - a.x) * (c.y - a.y) - (c.x - a.x) * (point.y - a.y);
  return !((ab < 0 || bc < 0 || ca < 0) && (ab > 0 || bc > 0 || ca > 0));
}

/** Independent Canvas simulation. React only receives deliberate playback changes. */
export class AsciiOceanEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly resizeObserver: ResizeObserver;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private cellWidth = 9;
  private cellHeight = 12;
  private cols = 0;
  private rows = 0;
  private raf = 0;
  private lastTime = 0;
  private accumulator = 0;
  private time = 0;
  private paused = false;
  private disposed = false;
  private fishes: Fish[] = [];
  private sharks: Shark[] = [];
  private ripples: Ripple[] = [];
  private energy = new Float32Array(0);
  private nextEnergy = new Float32Array(0);
  private pointer: Point & { active: boolean } = { x: 0, y: 0, active: false };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onPauseChange: (paused: boolean) => void) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    this.paused = this.motionPreference.matches;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    canvas.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('blur', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.motionPreference.addEventListener('change', this.onMotionChange);
    this.resize();
    this.onPauseChange(this.paused);
    this.schedule();
    // The first frame may precede the locally hosted monospace font finishing.
    void document.fonts.ready.then(() => { if (!this.disposed && this.paused) this.draw(); });
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.motionPreference.removeEventListener('change', this.onMotionChange);
  }

  togglePause() {
    this.paused = !this.paused;
    this.onPauseChange(this.paused);
    this.schedule();
  }

  disturb() {
    this.splashAt(this.width * 0.55, this.height * 0.55);
  }

  private resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    const previousWidth = this.width;
    const previousHeight = this.height;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cellWidth = width < 640 ? 6 : width < 1100 ? 8 : 9;
    this.cellHeight = Math.round(this.cellWidth * 1.4);
    this.cols = Math.ceil(width / this.cellWidth);
    this.rows = Math.ceil(height / this.cellHeight);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.energy = new Float32Array(this.cols * this.rows);
    this.nextEnergy = new Float32Array(this.cols * this.rows);
    if (!previousWidth) this.seed();
    else {
      for (const fish of this.fishes) {
        fish.x *= width / previousWidth;
        fish.y *= height / previousHeight;
      }
      this.sharks.forEach((shark, index) => {
        shark.x *= width / previousWidth;
        shark.y *= height / previousHeight;
        shark.length = this.sharkLength(index);
      });
      const fishCount = this.fishCount();
      if (fishCount < this.fishes.length) this.fishes.length = fishCount;
      while (this.fishes.length < fishCount) this.fishes.push(this.makeFish(this.fishes.length));
      this.ripples = [];
    }
    this.draw();
  }

  private fishCount() {
    return Math.round(clamp(this.width * this.height / 6000, 55, 210));
  }

  private sharkLength(index: number) {
    return clamp(Math.min(this.width * 0.39, this.height * 0.57), 145, 430) * [1, 0.86, 0.92][index];
  }

  private makeFish(index: number): Fish {
    // Loose schools make the collective motion visible from the first frame.
    const school = index % 3;
    const angle = school * 2.1 + 0.35;
    return {
      x: clamp(this.width * [0.64, 0.3, 0.82][school] + (Math.random() - 0.5) * this.width * 0.45, 0, this.width),
      y: clamp(this.height * [0.3, 0.66, 0.76][school] + (Math.random() - 0.5) * this.height * 0.32, 70, this.height - 60),
      vx: Math.cos(angle) * 34,
      vy: Math.sin(angle) * 34,
      phase: Math.random() * TAU,
      depth: 0.3 + Math.random() * 0.7,
      alarm: 0,
    };
  }

  private seed() {
    this.fishes = Array.from({ length: this.fishCount() }, (_, index) => this.makeFish(index));
    const compact = this.width < 640;
    const kinds: SharkKind[] = ['reef', 'hammerhead', 'thresher'];
    this.sharks = kinds.map((kind, index) => ({
      x: this.width * (compact ? [0.6, 0.3, 0.72] : [0.7, 0.34, 0.78])[index],
      y: this.height * [0.32, 0.67, 0.73][index],
      heading: [-0.45, 0.45, 3.7][index],
      speed: 27 + index * 3,
      phase: index * 2.4,
      length: this.sharkLength(index),
      turn: 0,
      kind,
    }));
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.accumulator = 0;
    if (this.paused || document.hidden || this.disposed) return;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.accumulator += Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;
    while (this.accumulator >= STEP) {
      this.step(STEP);
      this.accumulator -= STEP;
    }
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private step(dt: number) {
    this.time += dt;
    this.stepFish(dt);
    this.stepSharks(dt);
    for (const ripple of this.ripples) ripple.age += dt;
    this.ripples = this.ripples.filter(ripple => ripple.age < 1.8);
    this.updateEnergy();
  }

  private stepFish(dt: number) {
    for (let i = 0; i < this.fishes.length; i++) {
      const fish = this.fishes[i];
      let ax = 0;
      let ay = 0;
      let vx = 0;
      let vy = 0;
      let cx = 0;
      let cy = 0;
      let count = 0;
      for (let j = 0; j < this.fishes.length; j++) {
        if (i === j) continue;
        const other = this.fishes[j];
        const dx = other.x - fish.x;
        const dy = other.y - fish.y;
        const squared = dx * dx + dy * dy;
        if (squared > 78 * 78 || squared < 0.1) continue;
        if (squared < 25 * 25) {
          ax -= dx / squared * 190;
          ay -= dy / squared * 190;
        }
        vx += other.vx;
        vy += other.vy;
        cx += other.x;
        cy += other.y;
        count++;
      }
      if (count) {
        ax += (vx / count - fish.vx) * 0.65 + (cx / count - fish.x) * 0.045;
        ay += (vy / count - fish.vy) * 0.65 + (cy / count - fish.y) * 0.045;
      }
      let threat = 0;
      for (const shark of this.sharks) {
        const dx = fish.x - shark.x;
        const dy = fish.y - shark.y;
        const distance = Math.hypot(dx, dy);
        const fearRadius = shark.length * 0.63;
        if (distance >= fearRadius) continue;
        const pressure = 1 - distance / fearRadius;
        const side = dx * -Math.sin(shark.heading) + dy * Math.cos(shark.heading) >= 0 ? 1 : -1;
        ax += (dx / Math.max(distance, 1) * 0.7 - Math.sin(shark.heading) * side * 0.55) * pressure * 180;
        ay += (dy / Math.max(distance, 1) * 0.7 + Math.cos(shark.heading) * side * 0.55) * pressure * 180;
        threat = Math.max(threat, pressure);
      }
      if (this.pointer.active) {
        const dx = fish.x - this.pointer.x;
        const dy = fish.y - this.pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 130) {
          const pressure = (1 - distance / 130) ** 2;
          ax += dx / Math.max(distance, 1) * pressure * 260;
          ay += dy / Math.max(distance, 1) * pressure * 260;
          threat = Math.max(threat, pressure);
        }
      }
      // Brief panic decays gradually after the predator or click has passed.
      fish.alarm = Math.max(threat, fish.alarm - dt * 0.6);
      ax += Math.sin(this.time * 0.4 + fish.phase) * 4;
      ay += Math.cos(this.time * 0.3 + fish.phase) * 4;
      fish.vx += ax * dt;
      fish.vy += ay * dt;
      const speed = Math.hypot(fish.vx, fish.vy);
      const targetSpeed = 30 + fish.alarm * 85;
      const nextSpeed = clamp(speed + (targetSpeed - speed) * dt * 1.8, 15, 130);
      fish.vx = speed > 0.01 ? fish.vx / speed * nextSpeed : nextSpeed;
      fish.vy = speed > 0.01 ? fish.vy / speed * nextSpeed : 0;
      fish.x = wrap(fish.x + fish.vx * dt, this.width);
      fish.y = wrap(fish.y + fish.vy * dt, this.height);
    }
  }

  private stepSharks(dt: number) {
    this.sharks.forEach((shark, index) => {
      // Keep broad paths inside the usable water, including room for the tail.
      const orbit = this.time * 0.075 + index * 2.1;
      const margin = Math.min(shark.length * 0.65, this.width * 0.27);
      const waterTop = Math.min(this.width < 640 ? 220 : 90, this.height * 0.29) + shark.length * 0.3;
      const waterBottom = Math.max(waterTop + 30, this.height - 70 - shark.length * 0.3);
      let targetX = margin + (this.width - margin * 2) * (0.5 + Math.cos(orbit) * 0.32);
      let targetY = waterTop + (waterBottom - waterTop) * (0.5 + Math.sin(orbit) * 0.32);
      let best = 170;
      for (const fish of this.fishes) {
        const dx = fish.x - shark.x;
        const dy = fish.y - shark.y;
        const distance = Math.hypot(dx, dy);
        const ahead = dx * Math.cos(shark.heading) + dy * Math.sin(shark.heading);
        if (ahead > 20 && distance < best) {
          targetX = targetX * 0.85 + fish.x * 0.15;
          targetY = targetY * 0.85 + fish.y * 0.15;
          best = distance;
        }
      }
      // Anticipate the boundary; slow down while turning instead of leaving the frame.
      const aheadX = shark.x + Math.cos(shark.heading) * shark.speed * 2.2;
      const aheadY = shark.y + Math.sin(shark.heading) * shark.speed * 2.2;
      const nearBoundary = aheadX < margin || aheadX > this.width - margin || aheadY < waterTop || aheadY > waterBottom;
      if (nearBoundary) {
        targetX = this.width * 0.5;
        targetY = (waterTop + waterBottom) * 0.5;
      }
      let desired = Math.atan2(targetY - shark.y, targetX - shark.x);
      for (const other of this.sharks) {
        if (other === shark) continue;
        const dx = shark.x - other.x;
        const dy = shark.y - other.y;
        const distance = Math.hypot(dx, dy);
        if (distance < shark.length * 0.6 && distance > 1) {
          desired += angleDifference(desired, Math.atan2(dy, dx)) * (1 - distance / (shark.length * 0.6)) * 0.5;
        }
      }
      const turnSpeed = nearBoundary ? 0.95 : 0.48;
      const turn = clamp(angleDifference(shark.heading, desired), -dt * turnSpeed, dt * turnSpeed);
      shark.heading += turn;
      shark.turn += (turn / dt - shark.turn) * dt * 3;
      shark.speed += ((nearBoundary ? 18 : 27 + index * 3) - shark.speed) * dt * 2;
      shark.phase += dt * 2.1;
      shark.x += Math.cos(shark.heading) * shark.speed * dt;
      shark.y += Math.sin(shark.heading) * shark.speed * dt;
    });
  }

  private cellIndex(x: number, y: number) {
    const col = Math.floor(x / this.cellWidth);
    const row = Math.floor(y / this.cellHeight);
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows ? row * this.cols + col : -1;
  }

  private updateEnergy() {
    for (const fish of this.fishes) {
      const index = this.cellIndex(fish.x, fish.y);
      if (index >= 0) this.energy[index] = Math.min(1, this.energy[index] + 0.025 + fish.alarm * 0.07);
    }
    for (const shark of this.sharks) {
      const index = this.cellIndex(shark.x - Math.cos(shark.heading) * shark.length * 0.52, shark.y - Math.sin(shark.heading) * shark.length * 0.52);
      if (index >= 0) this.energy[index] = Math.min(1, this.energy[index] + 0.28);
    }
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const index = row * this.cols + col;
        const left = col ? this.energy[index - 1] : 0;
        const right = col < this.cols - 1 ? this.energy[index + 1] : 0;
        const up = row ? this.energy[index - this.cols] : 0;
        const down = row < this.rows - 1 ? this.energy[index + this.cols] : 0;
        this.nextEnergy[index] = (this.energy[index] * 0.68 + (left + right + up + down) * 0.08) * 0.965;
      }
    }
    [this.energy, this.nextEnergy] = [this.nextEnergy, this.energy];
  }

  private draw() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#080e12';
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `400 ${this.cellHeight}px "JetBrains Mono", monospace`;
    this.drawWater();
    this.drawFish();
    for (const shark of this.sharks) this.drawShark(shark);
    this.drawRipples();
  }

  private drawWater() {
    const { ctx } = this;
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(124, 163, 173, .065)';
    ctx.beginPath();
    for (let col = 0; col <= this.cols; col++) {
      const x = col * this.cellWidth + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
    }
    for (let row = 0; row <= this.rows; row++) {
      const y = row * this.cellHeight + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.stroke();
    for (let index = 0; index < this.energy.length; index++) {
      const energy = this.energy[index];
      const ambient = (index * 13 + Math.floor(index / this.cols) * 7) % 193 === 0;
      if (energy < 0.025 && !ambient) continue;
      ctx.fillStyle = `rgba(104, 195, 189, ${ambient ? 0.12 : clamp(energy * 1.8, 0.06, 0.55)})`;
      ctx.fillText(energy > 0.3 ? ':' : '.', (index % this.cols + 0.5) * this.cellWidth, (Math.floor(index / this.cols) + 0.5) * this.cellHeight);
    }
  }

  private drawFish() {
    const { ctx } = this;
    const occupied = new Set<number>();
    for (const fish of this.fishes) {
      const index = this.cellIndex(fish.x, fish.y);
      if (index < 0 || occupied.has(index)) continue;
      occupied.add(index);
      const x = (index % this.cols + 0.5) * this.cellWidth;
      const y = (Math.floor(index / this.cols) + 0.5) * this.cellHeight;
      ctx.fillStyle = fish.alarm > 0.45 ? `rgba(132, 231, 213, ${0.6 + fish.depth * 0.3})` : `rgba(155, 188, 194, ${0.35 + fish.depth * 0.42})`;
      const vertical = Math.abs(fish.vy) > Math.abs(fish.vx) * 1.8;
      const glyph = vertical ? (fish.vy > 0 ? 'v' : '^') : fish.vx > 0 ? '>' : '<';
      ctx.fillText(glyph, x, y);
      if (fish.depth > 0.73) {
        ctx.globalAlpha = 0.35;
        ctx.fillText('.', x - Math.sign(fish.vx) * this.cellWidth, y);
        ctx.globalAlpha = 1;
      }
    }
  }

  private bend(shark: Shark, t: number) {
    const tailWeight = clamp((t - 0.15) / 0.85, 0, 1.3);
    return Math.sin(shark.phase - t * 5.5) * 0.045 * tailWeight * tailWeight - shark.turn * tailWeight * tailWeight * 0.12;
  }

  private bodyWidth(kind: SharkKind, t: number) {
    if (t < 0 || t > 0.94) return 0;
    if (kind === 'hammerhead' && t < 0.115) {
      return 0.16 * Math.sin(Math.min(1, t / 0.035) * Math.PI / 2);
    }
    if (t < 0.2) return 0.086 * Math.sqrt(Math.max(0, 1 - ((t - 0.2) / 0.2) ** 2));
    return 0.007 + 0.079 * (1 - (t - 0.2) / 0.74) ** 1.55;
  }

  private fins(shark: Shark): Triangle[] {
    const point = (t: number, y: number): Point => ({ x: 0.42 - t, y: y + this.bend(shark, t) });
    const triangles: Triangle[] = [];
    for (const side of [-1, 1]) {
      triangles.push([point(0.25, side * 0.055), point(0.55, side * 0.255), point(0.45, side * 0.027)]);
      triangles.push([point(0.65, side * 0.025), point(0.77, side * 0.095), point(0.76, side * 0.013)]);
    }
    const tailTip = shark.kind === 'thresher' ? 0.36 : 0.18;
    triangles.push([point(0.87, 0), point(1.14, -tailTip), point(1.035, -0.02)]);
    triangles.push([point(0.87, 0), point(1.08, 0.15), point(1.035, 0.02)]);
    // A narrow central ridge reads as the dorsal fin from above.
    triangles.push([point(0.32, 0), point(0.51, -0.055), point(0.57, 0)]);
    return triangles;
  }

  private sampleShark(shark: Shark, triangles: Triangle[], x: number, y: number): Sample | null {
    const t = 0.42 - x;
    const centerY = y - this.bend(shark, t);
    const width = this.bodyWidth(shark.kind, t);
    if (width > 0 && Math.abs(centerY) <= width) {
      const eyeT = shark.kind === 'hammerhead' ? 0.065 : 0.105;
      const eyeY = shark.kind === 'hammerhead' ? 0.135 : this.bodyWidth(shark.kind, eyeT) * 0.72;
      const eye = Math.abs(t - eyeT) < 0.014 && Math.abs(Math.abs(centerY) - eyeY) < 0.014;
      return { shade: Math.sqrt(1 - (centerY / width) ** 2), fin: false, eye };
    }
    if (triangles.some(triangle => inTriangle({ x, y }, triangle))) return { shade: 0.38, fin: true, eye: false };
    return null;
  }

  private drawShark(shark: Shark) {
    const { ctx } = this;
    const cos = Math.cos(shark.heading);
    const sin = Math.sin(shark.heading);
    const radius = shark.length * 0.91;
    const startCol = Math.max(0, Math.floor((shark.x - radius) / this.cellWidth));
    const endCol = Math.min(this.cols - 1, Math.ceil((shark.x + radius) / this.cellWidth));
    const startRow = Math.max(0, Math.floor((shark.y - radius) / this.cellHeight));
    const endRow = Math.min(this.rows - 1, Math.ceil((shark.y + radius) / this.cellHeight));
    const triangles = this.fins(shark);
    const ramp = '.,:;irsXA253hMHGS#9B&@';
    const base = shark.kind === 'reef' ? [195, 211, 209] : shark.kind === 'hammerhead' ? [195, 194, 173] : [160, 183, 197];
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const screenX = (col + 0.5) * this.cellWidth;
        const screenY = (row + 0.5) * this.cellHeight;
        const dx = screenX - shark.x;
        const dy = screenY - shark.y;
        const x = (dx * cos + dy * sin) / shark.length;
        const y = (-dx * sin + dy * cos) / shark.length;
        const sample = this.sampleShark(shark, triangles, x, y);
        if (!sample) continue;
        const texture = (Math.sin(x * 146 + y * 79) + Math.cos(x * 73 - y * 137)) * 0.065;
        const light = clamp(0.2 + sample.shade * 0.7 + texture, 0.2, 1);
        const glyph = sample.eye ? 'o' : ramp[Math.floor(clamp(sample.shade * 0.8 + texture, 0, 0.999) * ramp.length)];
        // A dim backing clears fish beneath the body without turning it into a solid sprite.
        ctx.fillStyle = `rgba(13, 22, 26, ${sample.fin ? 0.6 : 0.95})`;
        ctx.fillRect(col * this.cellWidth, row * this.cellHeight, this.cellWidth, this.cellHeight);
        ctx.fillStyle = sample.eye ? '#d5f4e3' : `rgb(${base.map(channel => Math.round(channel * light)).join(',')})`;
        ctx.fillText(glyph, screenX, screenY);
      }
    }
  }

  private drawRipples() {
    const { ctx } = this;
    for (const ripple of this.ripples) {
      const radius = 10 + ripple.age * 150;
      const alpha = (1 - ripple.age / 1.8) ** 2;
      const extent = radius + this.cellHeight;
      const colStart = Math.max(0, Math.floor((ripple.x - extent) / this.cellWidth));
      const colEnd = Math.min(this.cols - 1, Math.ceil((ripple.x + extent) / this.cellWidth));
      const rowStart = Math.max(0, Math.floor((ripple.y - extent) / this.cellHeight));
      const rowEnd = Math.min(this.rows - 1, Math.ceil((ripple.y + extent) / this.cellHeight));
      ctx.fillStyle = `rgba(129, 224, 205, ${alpha * 0.8})`;
      for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
          const x = (col + 0.5) * this.cellWidth;
          const y = (row + 0.5) * this.cellHeight;
          if (Math.abs(Math.hypot(x - ripple.x, y - ripple.y) - radius) < this.cellWidth * 0.6) ctx.fillText('+', x, y);
        }
      }
    }
  }

  private splashAt(x: number, y: number) {
    // Pausing freezes both the simulation and its input, so it is a true still frame.
    if (this.paused) return;
    this.ripples.push({ x, y, age: 0 });
    if (this.ripples.length > 6) this.ripples.shift();
    for (const fish of this.fishes) {
      const dx = fish.x - x;
      const dy = fish.y - y;
      const distance = Math.hypot(dx, dy);
      if (distance > 230) continue;
      const angle = distance > 0.01 ? Math.atan2(dy, dx) : fish.phase;
      const force = (1 - distance / 230) * 160;
      fish.vx += Math.cos(angle) * force;
      fish.vy += Math.sin(angle) * force;
      fish.alarm = 1;
    }
  }

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: event.pointerType !== 'touch' };
  };

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = this.canvas.getBoundingClientRect();
    this.splashAt(event.clientX - rect.left, event.clientY - rect.top);
  };

  private onPointerLeave = () => { this.pointer.active = false; };
  private onVisibilityChange = () => { this.pointer.active = false; this.schedule(); };
  private onMotionChange = () => {
    this.paused = this.motionPreference.matches;
    this.onPauseChange(this.paused);
    this.schedule();
  };
}
