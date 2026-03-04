/**
 * Long press (press & hold) helper
 * - durationMs 以上押し続けると onComplete
 * - pointerup / pointerleave でキャンセル
 * - 進捗は CSS 変数 --lp (0..100) でボタンに反映
 */

export function bindLongPress(button, durationMs, onComplete, isDisabled = () => false) {
  let raf = 0;
  let t0 = 0;
  let activePointerId = null;

  function reset() {
    button.style.setProperty('--lp', '0');
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    t0 = 0;
    activePointerId = null;
  }

  function tick(now) {
    const p = Math.min(1, (now - t0) / durationMs);
    button.style.setProperty('--lp', String(p * 100));
    if (p >= 1) {
      reset();
      onComplete();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  button.addEventListener('pointerdown', (e) => {
    if (isDisabled()) return;
    if (activePointerId != null) return;
    activePointerId = e.pointerId;
    button.setPointerCapture?.(e.pointerId);
    t0 = performance.now();
    raf = requestAnimationFrame(tick);
  });

  const cancel = () => {
    if (activePointerId == null) return;
    reset();
  };

  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('pointerleave', cancel);

  return { reset };
}
