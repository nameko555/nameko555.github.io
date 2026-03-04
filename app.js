import { bindLongPress } from './longpress.js';
import { SoundManager } from './sound.js';
import { createToaster } from './toast.js';
import { DEFAULT_SETTINGS, STORAGE_KEYS, loadAll, saveMany } from './storage.js';
import { angleToIndex, buildStaticWheel, cryptoUniform360, normalizeDeg, renderWheel, shorten } from './wheel.js';

const SPIN_MS = 5000; // 演出5秒固定
const MAX_CANDIDATES = 1000;
const UNDER_NEEDLE_MIN_INTERVAL_MS = 33; // DOM更新を間引く（約30fps）
const AUTO_RESULT_MS = 1500; // 結果を自動で待機に戻す（配信テンポ改善）

const State = {
  idle: 'idle',
  spinning: 'spinning',
  result: 'result',
};

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function parseCandidates(text) {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.trim());

  let truncated = 0;
  const limited = lines.map((s) => {
    if (s.length <= 200) return s;
    truncated += 1;
    return s.slice(0, 200);
  });

  let nonEmpty = limited.filter((s) => s.length > 0);
  const removed = limited.length - nonEmpty.length;

  // 上限（1000）を超える場合は、配信事故（フリーズ）防止のため切り捨てる
  let capped = 0;
  if (nonEmpty.length > MAX_CANDIDATES) {
    capped = nonEmpty.length - MAX_CANDIDATES;
    nonEmpty = nonEmpty.slice(0, MAX_CANDIDATES);
  }

  const freq = new Map();
  // 「重複“種類”」ではなく「重複“行”（口数の増分）」として数える
  let duplicateLines = 0;
  for (const s of nonEmpty) {
    const c = (freq.get(s) || 0) + 1;
    freq.set(s, c);
    if (c >= 2) duplicateLines += 1;
  }

  return {
    candidates: nonEmpty,
    stats: {
      totalLines: limited.length,
      valid: nonEmpty.length,
      removedEmpty: removed,
      duplicateLines,
      truncated,
      capped,
    },
  };
}

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function main() {
  const els = {
    status: document.getElementById('status'),
    statePill: document.getElementById('statePill'),
    audioWarn: document.getElementById('audioWarn'),
    candidateSummary: document.getElementById('candidateSummary'),
    draft: document.getElementById('draft'),
    loadBtn: document.getElementById('loadBtn'),
    clearCandidatesBtn: document.getElementById('clearCandidatesBtn'),
    wheel: document.getElementById('wheel'),
    underNeedle: document.getElementById('underNeedle'),
    winner: document.getElementById('winner'),
    hudFlash: document.getElementById('hudFlash'),
    centerHud: document.querySelector('.centerHud'), /* ←★これを追加 */
    spinBtn: document.getElementById('spinBtn'),
    cropGuide: document.getElementById('cropGuide'),
    startupHint: document.getElementById('startupHint'),
    hideHintBtn: document.getElementById('hideHintBtn'),
    dontShowHint: document.getElementById('dontShowHint'),
    history: document.getElementById('history'),
    clearHistoryBtn: document.getElementById('clearHistoryBtn'),
    soundToggle: document.getElementById('soundToggle'),
    volume: document.getElementById('volume'),
    cropToggle: document.getElementById('cropToggle'),
    debugToggle: document.getElementById('debugToggle'),
    debug: document.getElementById('debug'),
    toasts: document.getElementById('toasts'),
  };

  const toaster = createToaster(els.toasts);
  const sound = new SoundManager(els.audioWarn);

  let ctx = els.wheel.getContext('2d', { alpha: true });
  let off = document.createElement('canvas');
  let offCtx = off.getContext('2d', { alpha: true });

  let appState = State.idle;
  let phi = 0; // deg
  let committedCandidates = [];
  let history = [];
  let settings = { ...DEFAULT_SETTINGS };

  // 針下表示（DOM）更新の間引き
  let lastUnderNeedleText = '';
  let lastUnderNeedleUpdate = 0;

  // result auto-return timer
  let resultAutoTimer = 0;

  // HiDPI/リサイズ追従
  let lastWheelCssSize = 0;
  const wheelWrap = els.wheel.closest('.wheelWrap');
  function resizeCanvasesIfNeeded(cssSizePx) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssSize = Math.max(1, Math.floor(cssSizePx));
    if (!cssSize || cssSize === lastWheelCssSize) return;
    lastWheelCssSize = cssSize;

    const px = Math.max(1, Math.floor(cssSize * dpr));

    // onscreen
    els.wheel.width = px;
    els.wheel.height = px;
    ctx = els.wheel.getContext('2d', { alpha: true });

    // offscreen
    off = document.createElement('canvas');
    off.width = px;
    off.height = px;
    offCtx = off.getContext('2d', { alpha: true });

    rebuildWheel();
  }

  if (wheelWrap && 'ResizeObserver' in window) {
    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const size = Math.min(e.contentRect.width, e.contentRect.height);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => resizeCanvasesIfNeeded(size));
    });
    ro.observe(wheelWrap);
  }

  function setState(next) {
  appState = next;
  els.statePill.textContent = next;

  // mode classes for streamer-friendly HUD behavior
  els.centerHud.classList.remove('mode-idle', 'mode-spinning', 'mode-result');
  els.centerHud.classList.remove('is-visible');
  if (next === State.spinning) els.centerHud.classList.add('mode-spinning');
  else if (next === State.result) {
    els.centerHud.classList.add('mode-result');
    // 中央HUDは「結果表示」のみにする
    els.centerHud.classList.add('is-visible');
  } else {
    els.centerHud.classList.add('mode-idle');
  }

  // clear any pending auto-return
  if (resultAutoTimer) {
    clearTimeout(resultAutoTimer);
    resultAutoTimer = 0;
  }

  // Auto-return to idle after a short moment (keeps pace during live)
  if (next === State.result) {
    resultAutoTimer = setTimeout(() => {
      // don't interrupt a new spin/load
      if (appState === State.result) {
        setState(State.idle);
        updateLocks();
        updateDebug('');
      }
    }, AUTO_RESULT_MS);
  }
}

  function isLocked() {
    return appState === State.spinning;
  }

  function updateLocks() {
    const locked = isLocked();
    els.draft.disabled = locked;
    els.loadBtn.disabled = locked;
    els.clearCandidatesBtn.disabled = locked;
    els.clearHistoryBtn.disabled = locked;
    els.soundToggle.disabled = locked;
    els.volume.disabled = locked;
    els.cropToggle.disabled = locked;
    els.debugToggle.disabled = locked;
    els.hideHintBtn.disabled = locked;
    els.dontShowHint.disabled = locked;

    els.spinBtn.disabled = locked || committedCandidates.length === 0;
  }

  function updateStatus() {
    els.status.textContent = `抽選対象: ${committedCandidates.length}件（Load済み） / 履歴: ${history.length}件`;
    els.candidateSummary.textContent = `抽選対象: ${committedCandidates.length}件（Load済み）`;
  }

  function renderHistory() {
    els.history.innerHTML = '';
    if (history.length === 0) {
      const li = document.createElement('li');
      li.textContent = '（まだありません）';
      els.history.appendChild(li);
      return;
    }
    for (const h of history) {
      const li = document.createElement('li');
      li.textContent = `${h.name}（${formatTime(h.ts)}）`;
      els.history.appendChild(li);
    }
  }

  function applySettings() {
    els.soundToggle.checked = !!settings.soundEnabled;
    els.volume.value = String(settings.volume ?? 0.3);
    els.cropToggle.checked = !!settings.cropGuide;
    els.debugToggle.checked = !!settings.debug;
    els.cropGuide.classList.toggle('on', !!settings.cropGuide);
    els.debug.hidden = !settings.debug;
    els.startupHint.hidden = !settings.showStartupHint;
    els.dontShowHint.checked = !settings.showStartupHint;
  }

  function saveSettings() {
    return saveMany({ [STORAGE_KEYS.settings]: settings });
  }

  function rebuildWheel() {
    buildStaticWheel(offCtx, committedCandidates, {
      drawLabels: true,
    });
    renderWheel(ctx, off, phi);
    updateUnderNeedle({ force: true });
  }

  function updateUnderNeedle({ force = false, now = performance.now() } = {}) {
    if (committedCandidates.length === 0) {
      if (force || lastUnderNeedleText !== '—') {
        els.underNeedle.textContent = '—';
        lastUnderNeedleText = '—';
      }
      return;
    }

    if (!force && now - lastUnderNeedleUpdate < UNDER_NEEDLE_MIN_INTERVAL_MS) return;

    const idx = angleToIndex(phi, committedCandidates.length);
    const nextText = `${idx + 1}. ${shorten(committedCandidates[idx], 40)}`;
    if (force || nextText !== lastUnderNeedleText) {
      els.underNeedle.textContent = nextText;
      lastUnderNeedleText = nextText;
    }
    lastUnderNeedleUpdate = now;
  }

  function updateDebug(extra = '') {
    if (!settings.debug) return;
    const n = committedCandidates.length;
    const delta = n > 0 ? 360 / n : 0;
    const idx = n > 0 ? angleToIndex(phi, n) : 0;
    const phiN = normalizeDeg(phi);
    els.debug.textContent = [
      `state: ${appState}`,
      `N: ${n}`,
      `Δ: ${delta.toFixed(6)} deg`,
      `φ: ${phiN.toFixed(3)} deg`,
      `index: ${idx}`,
      extra,
    ]
      .filter(Boolean)
      .join('\n');
  }


function showHudFlash(message, ms = 700) {
  if (!els.hudFlash) return;
  els.hudFlash.textContent = message;
  els.hudFlash.classList.add('is-show');
  window.clearTimeout(showHudFlash._t);
  showHudFlash._t = window.setTimeout(() => {
    els.hudFlash.classList.remove('is-show');
  }, ms);
}

  function setWinner(text, { pop = false } = {}) {
  els.winner.textContent = text ? shorten(text, 48) : '—';
  if (pop) {
    els.winner.classList.remove('is-pop');
    // restart animation
    void els.winner.offsetWidth;
    els.winner.classList.add('is-pop');
    window.clearTimeout(setWinner._t);
    setWinner._t = window.setTimeout(() => els.winner.classList.remove('is-pop'), 500);
  } else {
    els.winner.classList.remove('is-pop');
  }
}

  const saveDraftDebounced = debounce(async (txt) => {
    await saveMany({ [STORAGE_KEYS.draftText]: txt });
  }, 500);

  // --- events
  els.draft.addEventListener('input', () => {
    if (isLocked()) return;
    saveDraftDebounced(els.draft.value);
  });

  els.loadBtn.addEventListener('click', async () => {
    if (isLocked()) return;
    if (appState === State.result) setState(State.idle);

    const { candidates, stats } = parseCandidates(els.draft.value);
    if (candidates.length === 0) {
      toaster.toast('候補が0件です（空行は除外されます）');
      sound.beep({ enabled: settings.soundEnabled, volume: settings.volume, type: 'bad' });
      committedCandidates = [];
      await saveMany({ [STORAGE_KEYS.committedCandidates]: committedCandidates });
      rebuildWheel();
      updateStatus();
      updateLocks();
      return;
    }

    committedCandidates = candidates;
    await saveMany({ [STORAGE_KEYS.committedCandidates]: committedCandidates });
    rebuildWheel();
    updateStatus();
    updateLocks();
    setWinner('—');

    const extraA = stats.truncated ? ` / 200字超${stats.truncated}行は切り詰め` : '';
    const extraB = stats.capped ? ` / 1000件上限で${stats.capped}件は除外` : '';
    toaster.toast(
      `Load完了: ${stats.valid}件（空行除外${stats.removedEmpty} / 重複行+${stats.duplicateLines}${extraA}${extraB}）`,
    );
    showHudFlash(`${stats.valid} entries loaded`);
    sound.beep({ enabled: settings.soundEnabled, volume: settings.volume, type: 'click' });
  });

  els.spinBtn.addEventListener('click', async () => {
    if (isLocked()) return;
    if (committedCandidates.length === 0) return;
    if (appState === State.result) setState(State.idle);

    setState(State.spinning);
    updateLocks();
    setWinner('');

    const stopAngle = cryptoUniform360();
    const k = 10; // 演出専用
    const startPhi = phi;
    const targetPhi = startPhi + 360 * k + stopAngle;
    const t0 = performance.now();

    sound.beep({ enabled: settings.soundEnabled, volume: settings.volume, type: 'click' });

    await new Promise((resolve) => {
      function step(now) {
        const t = Math.min(1, (now - t0) / SPIN_MS);
        const e = easeOutCubic(t);
        phi = startPhi + (targetPhi - startPhi) * e;
        renderWheel(ctx, off, phi);
        updateUnderNeedle({ now });
        updateDebug(`stopAngle: ${stopAngle.toFixed(4)} / Φ_target: ${targetPhi.toFixed(2)}`);
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(step);
    });

    const idx = angleToIndex(phi, committedCandidates.length);
    const name = committedCandidates[idx];
    setWinner(name);

    history = [{ ts: Date.now(), name }, ...history].slice(0, 100);
    await saveMany({ [STORAGE_KEYS.history]: history });
    renderHistory();

    toaster.toast(`当選: ${name}`);
    sound.beep({ enabled: settings.soundEnabled, volume: settings.volume, type: 'ok' });

    setState(State.result);
    updateLocks();
    updateStatus();
    updateDebug('');
  });

  bindLongPress(
    els.clearCandidatesBtn,
    2000,
    async () => {
      if (isLocked()) return;
      committedCandidates = [];
      phi = 0;
      els.draft.value = '';
      await saveMany({
        [STORAGE_KEYS.draftText]: '',
        [STORAGE_KEYS.committedCandidates]: [],
      });
      setWinner('—');
      rebuildWheel();
      updateStatus();
      updateLocks();
      toaster.toast('候補を全消去しました');
      sound.beep({ enabled: settings.soundEnabled, volume: settings.volume, type: 'ok' });
    },
    isLocked,
  );

  bindLongPress(
    els.clearHistoryBtn,
    2000,
    async () => {
      if (isLocked()) return;
      history = [];
      await saveMany({ [STORAGE_KEYS.history]: [] });
      renderHistory();
      updateStatus();
      toaster.toast('履歴を全消去しました');
      sound.beep({ enabled: settings.soundEnabled, volume: settings.volume, type: 'ok' });
    },
    isLocked,
  );

  els.soundToggle.addEventListener('change', async () => {
    if (isLocked()) return;
    settings = { ...settings, soundEnabled: els.soundToggle.checked };
    await saveSettings();
  });

  els.volume.addEventListener('input', async () => {
    if (isLocked()) return;
    settings = { ...settings, volume: Number(els.volume.value) };
    await saveSettings();
  });

  els.cropToggle.addEventListener('change', async () => {
    if (isLocked()) return;
    settings = { ...settings, cropGuide: els.cropToggle.checked };
    els.cropGuide.classList.toggle('on', !!settings.cropGuide);
    await saveSettings();
  });

  els.debugToggle.addEventListener('change', async () => {
    if (isLocked()) return;
    settings = { ...settings, debug: els.debugToggle.checked };
    els.debug.hidden = !settings.debug;
    await saveSettings();
    updateDebug('');
  });

  els.hideHintBtn.addEventListener('click', async () => {
    if (isLocked()) return;
    // 要件: 初回のみ表示（以後は表示しない）。必要なら設定リセットで再表示。
    settings = { ...settings, showStartupHint: false };
    els.startupHint.hidden = true;
    await saveSettings();
  });

// keyboard shortcuts (streaming-friendly)
window.addEventListener('keydown', (e) => {
  // ignore if typing
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  const typing = tag === 'textarea' || tag === 'input' || (e.target && e.target.isContentEditable);
  if (typing) return;

  if (e.code === 'Space') {
    e.preventDefault();
    els.spinBtn.click();
    return;
  }
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    els.loadBtn.click();
    return;
  }
  if (e.key === 'Escape') {
    // quick return to idle
    if (appState === State.result) {
      setState(State.idle);
      updateLocks();
      updateDebug('');
    }
  }
});

  // unlock audio after first user gesture
  window.addEventListener(
    'pointerdown',
    () => {
      sound.unlock();
    },
    { once: true, passive: true },
  );

  // --- init
  (async () => {
    const persisted = await loadAll();
    els.draft.value = persisted.draftText;
    committedCandidates = persisted.committedCandidates;
    history = persisted.history;
    settings = persisted.settings;

    applySettings();
    renderHistory();
    updateStatus();
    setState(State.idle);

    // 初期サイズ反映（ResizeObserverの初回通知待ちで描画が荒れないようにする）
    if (wheelWrap) {
      const rect = wheelWrap.getBoundingClientRect();
      resizeCanvasesIfNeeded(Math.min(rect.width, rect.height));
    }

    rebuildWheel();
    updateLocks();
    updateDebug('');
  })();
}

main();