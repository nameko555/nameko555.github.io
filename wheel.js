// ルーレット描画/抽選ロジック（要件 v3.0）

export const NEEDLE_DEG = 270; // 真上（-90deg = 270deg）

export function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

export function cryptoUniform360() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  const u = a[0] / 2 ** 32; // 0 <= u < 1
  return u * 360; // 0 <= x < 360
}

/**
 * 角度（回転量）から扇形インデックスを逆算
 * - 境界: 左閉右開 [iΔ, (i+1)Δ)
 */
export function angleToIndex(phiDeg, n, needleDeg = NEEDLE_DEG) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const delta = 360 / n;
  const alpha = normalizeDeg(needleDeg - phiDeg);
  const idx = Math.floor(alpha / delta);
  return Math.min(n - 1, Math.max(0, idx));
}

export function shorten(s, max = 18) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function colorForIndex(i, n) {
  const h = (i * (360 / Math.max(1, n))) % 360;
  return `hsl(${h}deg 70% 52%)`;
}

export function buildStaticWheel(offCtx, candidates, opts) {
  const { drawLabels } = opts;
  const n = candidates.length;
  const w = offCtx.canvas.width;
  const h = offCtx.canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.48;

  offCtx.clearRect(0, 0, w, h);

  // empty state
  if (n <= 0) {
    offCtx.save();
    offCtx.translate(cx, cy);
    offCtx.fillStyle = 'rgba(255,255,255,0.08)';
    offCtx.beginPath();
    offCtx.arc(0, 0, radius, 0, Math.PI * 2);
    offCtx.fill();
    offCtx.fillStyle = 'rgba(255,255,255,0.55)';
    offCtx.font = '16px system-ui';
    offCtx.textAlign = 'center';
    offCtx.textBaseline = 'middle';
    offCtx.fillText('Loadで候補を確定', 0, 0);
    offCtx.restore();
    return;
  }

  offCtx.save();
  offCtx.translate(cx, cy);
  offCtx.lineWidth = Math.max(1, radius * 0.01);
  offCtx.strokeStyle = 'rgba(0,0,0,0.35)';

  const delta = (Math.PI * 2) / n;
  for (let i = 0; i < n; i += 1) {
    const a0 = i * delta;
    const a1 = a0 + delta;
    offCtx.beginPath();
    offCtx.moveTo(0, 0);
    offCtx.arc(0, 0, radius, a0, a1, false);
    offCtx.closePath();
    offCtx.fillStyle = colorForIndex(i, n);
    offCtx.fill();
    offCtx.stroke();
  }

  // Outer ring
  offCtx.beginPath();
  offCtx.arc(0, 0, radius, 0, Math.PI * 2);
  offCtx.strokeStyle = 'rgba(255,255,255,0.20)';
  offCtx.lineWidth = Math.max(2, radius * 0.012);
  offCtx.stroke();

  if (drawLabels && n <= 200) {
    offCtx.save();
    offCtx.fillStyle = 'rgba(255,255,255,0.92)';
    offCtx.font = `${Math.max(10, Math.round(radius * 0.06))}px system-ui`;
    offCtx.textAlign = 'right';
    offCtx.textBaseline = 'middle';
    for (let i = 0; i < n; i += 1) {
      const mid = (i + 0.5) * delta;
      offCtx.save();
      offCtx.rotate(mid);
      offCtx.translate(radius * 0.94, 0);
      offCtx.fillText(shorten(candidates[i]), 0, 0);
      offCtx.restore();
    }
    offCtx.restore();
  }

  // center hub
  offCtx.beginPath();
  offCtx.arc(0, 0, radius * 0.14, 0, Math.PI * 2);
  offCtx.fillStyle = 'rgba(0,0,0,0.35)';
  offCtx.fill();
  offCtx.restore();
}

export function renderWheel(ctx, offCanvas, phiDeg) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cx = w / 2;
  const cy = h / 2;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((phiDeg * Math.PI) / 180);
  ctx.drawImage(offCanvas, -w / 2, -h / 2, w, h);
  ctx.restore();
}
