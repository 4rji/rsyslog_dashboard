'use strict';

// Local rsyslog panel: streams /stream (SSE) into the shared log panel and adds
// the local-only extras (text filter, filtered download, token double-click).

const searchInput = document.getElementById('search-input');
const btnPause    = document.getElementById('btn-pause');
const btnClear    = document.getElementById('btn-clear');
const btnDownload = document.getElementById('btn-download-filtered');
const connStatus  = document.getElementById('conn-status');
const logOutput   = document.getElementById('log-output');
const LOCAL_LOG_HISTORY_KEY = 'rsyslog-dashboard-local-log-history';

const currentFilter = () => searchInput.value.trim().toLowerCase();
const lineMatchesFilter = (line) => {
  const term = currentFilter();
  return !term || line.toLowerCase().includes(term);
};

function readLocalLogHistory() {
  try {
    const raw = sessionStorage.getItem(LOCAL_LOG_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveLocalLogHistory(lines) {
  try {
    sessionStorage.setItem(LOCAL_LOG_HISTORY_KEY, JSON.stringify(lines));
  } catch (_) {
    /* ignore storage failures */
  }
}

const panel = createLogPanel({
  output:     logOutput,
  container:  document.getElementById('log-container'),
  counter:    document.getElementById('counter'),
  autoscroll: document.getElementById('chk-autoscroll'),
  filter:     lineMatchesFilter,
});

for (const line of readLocalLogHistory()) {
  panel.push(line);
}
saveLocalLogHistory(panel.allLines);

function setConnStatus(state) {
  connStatus.className = `status-${state}`;
  const labels = { connecting: 'Connecting…', connected: 'Connected', error: 'Disconnected' };
  connStatus.textContent = labels[state] ?? state;
}

// ── SSE connection ───────────────────────────────────────────────────────────
const evtSource = new EventSource('/stream');
evtSource.onopen    = () => setConnStatus('connected');
evtSource.onmessage = (event) => {
  panel.push(event.data);
  saveLocalLogHistory(panel.allLines);
};
evtSource.onerror   = () => setConnStatus('error');  // EventSource auto-reconnects

// ── Controls ─────────────────────────────────────────────────────────────────
btnPause.addEventListener('click', () => {
  const paused = panel.togglePaused();
  btnPause.textContent = paused ? 'Resume' : 'Pause';
  btnPause.classList.toggle('active', paused);
});

btnClear.addEventListener('click', () => {
  panel.clear();
  saveLocalLogHistory([]);
});
searchInput.addEventListener('input', () => panel.rebuild());

btnDownload.addEventListener('click', () => {
  const visible = panel.allLines.filter(lineMatchesFilter);
  if (!visible.length) return;
  const today = new Date().toISOString().slice(0, 10);
  downloadLines(visible, filteredFilename(today, searchInput.value));
});

enableTokenFilter(logOutput, searchInput);
