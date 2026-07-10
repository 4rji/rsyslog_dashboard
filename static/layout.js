'use strict';

// Split-screen behavior: a draggable splitter to resize the two log panels,
// orientation toggle (horizontal or vertical), and per-panel Maximize / Restore.

const split = document.getElementById('split');
const splitter = document.getElementById('splitter');
const panelLocal = document.getElementById('panel-local');
const panelRemote = document.getElementById('panel-remote');
const layoutHorizontalBtn = document.getElementById('layout-horizontal');
const layoutVerticalBtn = document.getElementById('layout-vertical');

const ORIENTATION_KEY = 'rsyslog-dashboard-orientation';
const DEFAULT_ORIENTATION = window.matchMedia('(max-width: 800px)').matches ? 'vertical' : 'horizontal';
function readOrientation() {
  try {
    return localStorage.getItem(ORIENTATION_KEY);
  } catch (_) {
    return null;
  }
}

function saveOrientation(value) {
  try {
    localStorage.setItem(ORIENTATION_KEY, value);
  } catch (_) {
    /* ignore storage failures */
  }
}

const savedOrientation = readOrientation();
let orientation = savedOrientation === 'vertical' || savedOrientation === 'horizontal'
  ? savedOrientation
  : DEFAULT_ORIENTATION;

// Remembers the split ratio so Restore returns to the user's chosen size.
const savedFlex = {
  horizontal: { local: '', remote: '' },
  vertical: { local: '', remote: '' },
};

// ── Resizable splitter ───────────────────────────────────────────────────────
let dragging = false;

splitter.addEventListener('mousedown', (event) => {
  dragging = true;
  document.body.style.userSelect = 'none';
  event.preventDefault();
});

window.addEventListener('mouseup', () => {
  dragging = false;
  document.body.style.userSelect = '';
});

window.addEventListener('mousemove', (event) => {
  if (!dragging) return;
  const rect = split.getBoundingClientRect();
  const useVertical = orientation === 'vertical';
  let pct = useVertical
    ? ((event.clientY - rect.top) / rect.height) * 100
    : ((event.clientX - rect.left) / rect.width) * 100;
  pct = Math.max(15, Math.min(85, pct));
  panelLocal.style.flex = `0 0 ${pct}%`;
  panelRemote.style.flex = '1 1 0';
  savedFlex[orientation].local = panelLocal.style.flex;
  savedFlex[orientation].remote = panelRemote.style.flex;
});

function applyOrientation(nextOrientation) {
  orientation = nextOrientation;
  saveOrientation(orientation);
  split.dataset.orientation = orientation;
  document.body.dataset.layoutOrientation = orientation;
  splitter.setAttribute('aria-orientation', orientation === 'vertical' ? 'horizontal' : 'vertical');
  splitter.title = orientation === 'vertical' ? 'Drag to resize vertically' : 'Drag to resize horizontally';
  layoutHorizontalBtn.classList.toggle('active', orientation === 'horizontal');
  layoutVerticalBtn.classList.toggle('active', orientation === 'vertical');

  if (orientation === 'vertical') {
    splitter.style.cursor = 'row-resize';
  } else {
    splitter.style.cursor = 'col-resize';
  }

  if (savedFlex[orientation].local) {
    panelLocal.style.flex = savedFlex[orientation].local;
    panelRemote.style.flex = savedFlex[orientation].remote;
  } else {
    panelLocal.style.flex = '';
    panelRemote.style.flex = '';
  }
}

layoutHorizontalBtn.addEventListener('click', () => applyOrientation('horizontal'));
layoutVerticalBtn.addEventListener('click', () => applyOrientation('vertical'));

// ── Maximize / Restore ───────────────────────────────────────────────────────
function setMaximized(target) {
  const wasMax = target.classList.contains('is-max');

  // Always restore to the split layout first.
  panelLocal.classList.remove('is-max', 'is-hidden');
  panelRemote.classList.remove('is-max', 'is-hidden');
  splitter.classList.remove('is-hidden');
  document.querySelectorAll('.btn-max').forEach((b) => (b.textContent = 'Maximize'));

  if (wasMax) {
    // Toggling off: reapply the remembered split ratio.
    panelLocal.style.flex = savedFlex[orientation].local;
    panelRemote.style.flex = savedFlex[orientation].remote;
    return;
  }

  // Maximize the target: clear inline flex so the .is-max CSS rule wins.
  panelLocal.style.flex = '';
  panelRemote.style.flex = '';
  target.classList.add('is-max');
  (target === panelLocal ? panelRemote : panelLocal).classList.add('is-hidden');
  splitter.classList.add('is-hidden');
  target.querySelector('.btn-max').textContent = 'Restore';
}

document.querySelectorAll('.btn-max').forEach((btn) => {
  btn.addEventListener('click', () =>
    setMaximized(document.getElementById(btn.dataset.target))
  );
});

applyOrientation(orientation);
