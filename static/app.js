'use strict';

const MAX_LINES = 10000;

// ── State ──────────────────────────────────────────────────────────────────
const allLines = [];
let isPaused = false;
const pauseBuffer = [];

// ── DOM refs ───────────────────────────────────────────────────────────────
const logOutput    = document.getElementById('log-output');
const logContainer = document.getElementById('log-container');
const counter      = document.getElementById('counter');
const searchInput  = document.getElementById('search-input');
const btnPause     = document.getElementById('btn-pause');
const btnClear     = document.getElementById('btn-clear');
const chkScroll    = document.getElementById('chk-autoscroll');
const connStatus   = document.getElementById('conn-status');
const btnDownload  = document.getElementById('btn-download-filtered');

// ── Helpers ────────────────────────────────────────────────────────────────
// escapeHtml / formatLine / enableTokenFilter live in format.js (shared with history)

function lineMatchesFilter(line) {
  const term = searchInput.value.trim().toLowerCase();
  return !term || line.toLowerCase().includes(term);
}

function appendLineToDOM(rawLine) {
  if (!lineMatchesFilter(rawLine)) return;
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = formatLine(rawLine);
  logOutput.appendChild(div);
  trimDOM();
  updateCounter();
  if (chkScroll.checked) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

function trimDOM() {
  const lines = logOutput.children;
  while (lines.length > MAX_LINES) {
    logOutput.removeChild(lines[0]);
  }
}

function updateCounter() {
  const n = logOutput.children.length;
  counter.textContent = `${n} line${n !== 1 ? 's' : ''}`;
}

function rebuildDOM() {
  logOutput.innerHTML = '';
  for (const line of allLines) {
    appendLineToDOM(line);
  }
}

function setConnStatus(state) {
  connStatus.className = `status-${state}`;
  const labels = { connecting: 'Connecting…', connected: 'Connected', error: 'Disconnected' };
  connStatus.textContent = labels[state] ?? state;
}

// ── SSE Connection ─────────────────────────────────────────────────────────
const evtSource = new EventSource('/stream');

evtSource.onopen = () => setConnStatus('connected');

evtSource.onmessage = (event) => {
  const line = event.data;
  if (isPaused) {
    pauseBuffer.push(line);
    return;
  }
  if (allLines.length >= MAX_LINES) {
    allLines.splice(0, Math.floor(MAX_LINES / 4));
  }
  allLines.push(line);
  appendLineToDOM(line);
};

evtSource.onerror = () => {
  setConnStatus('error');
  // EventSource reconnects automatically; status will flip back on next onopen
};

// ── Controls ───────────────────────────────────────────────────────────────
btnPause.addEventListener('click', () => {
  isPaused = !isPaused;
  btnPause.textContent = isPaused ? 'Resume' : 'Pause';
  btnPause.classList.toggle('active', isPaused);

  if (!isPaused && pauseBuffer.length > 0) {
    for (const line of pauseBuffer) {
      if (allLines.length >= MAX_LINES) {
        allLines.splice(0, Math.floor(MAX_LINES / 4));
      }
      allLines.push(line);
      appendLineToDOM(line);
    }
    pauseBuffer.length = 0;
  }
});

btnClear.addEventListener('click', () => {
  allLines.length = 0;
  pauseBuffer.length = 0;
  logOutput.innerHTML = '';
  updateCounter();
});

searchInput.addEventListener('input', rebuildDOM);

btnDownload.addEventListener('click', () => {
  const visible = allLines.filter(lineMatchesFilter);
  if (!visible.length) return;
  const today = new Date().toISOString().slice(0, 10);
  downloadLines(visible, filteredFilename(today, searchInput.value));
});

enableTokenFilter(logOutput, searchInput);
