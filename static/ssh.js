'use strict';

// Remote SSH panel: submits connection settings to /ssh/connect, then streams
// /ssh/stream (SSE) into the shared log panel. No filtering, per spec.
// Credentials are sent only in the connect request; the session token lives in
// an HttpOnly cookie the browser never exposes to JavaScript.

const sshForm       = document.getElementById('ssh-form');
const sshToolbar    = document.getElementById('ssh-toolbar');
const sshTarget     = document.getElementById('ssh-target');
const sshFormError  = document.getElementById('ssh-form-error');
const sshStatus     = document.getElementById('ssh-status');
const sshPass       = document.getElementById('ssh-pass');
const btnConnect    = document.getElementById('ssh-connect');
const btnDisconnect = document.getElementById('ssh-disconnect');
const btnChange     = document.getElementById('ssh-change');
const btnPauseSsh   = document.getElementById('ssh-pause');
const btnClearSsh   = document.getElementById('ssh-clear');
const sshSearch     = document.getElementById('ssh-search');
const btnDownloadSsh = document.getElementById('ssh-download');
const sshOutput     = document.getElementById('ssh-output');
const SSH_LOG_HISTORY_KEY = 'rsyslog-dashboard-ssh-log-history';
const sshHostHistoryList = document.getElementById('ssh-host-history');
const sshUserHistoryList = document.getElementById('ssh-user-history');
const sshPathHistoryList = document.getElementById('ssh-path-history');

const lineMatchesSshFilter = (line) => {
  const term = sshSearch.value.trim().toLowerCase();
  return !term || line.toLowerCase().includes(term);
};

const SSH_FORM_HISTORY_KEY = 'rsyslog-dashboard-ssh-form-history';
const SSH_RECENT_VALUES_KEY = 'rsyslog-dashboard-ssh-recent-values';

function readFormHistory() {
  try {
    const raw = localStorage.getItem(SSH_FORM_HISTORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveFormHistory(next) {
  try {
    localStorage.setItem(SSH_FORM_HISTORY_KEY, JSON.stringify(next));
  } catch (_) {
    /* ignore storage failures */
  }
}

function loadSavedField(id, fallback) {
  const saved = readFormHistory();
  return saved[id] ?? fallback;
}

function persistCurrentFormValues() {
  saveFormHistory({
    host: document.getElementById('ssh-host').value.trim(),
    port: document.getElementById('ssh-port').value,
    username: document.getElementById('ssh-user').value.trim(),
    log_path: document.getElementById('ssh-path').value.trim(),
  });
}

function readRecentValues() {
  try {
    const raw = localStorage.getItem(SSH_RECENT_VALUES_KEY);
    return raw ? JSON.parse(raw) : { host: [], user: [], path: [] };
  } catch (_) {
    return { host: [], user: [], path: [] };
  }
}

function saveRecentValues(next) {
  try {
    localStorage.setItem(SSH_RECENT_VALUES_KEY, JSON.stringify(next));
  } catch (_) {
    /* ignore storage failures */
  }
}

function pushRecentValue(bucket, value) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const recent = readRecentValues();
  const next = Array.isArray(recent[bucket]) ? recent[bucket].filter((item) => item !== trimmed) : [];
  next.unshift(trimmed);
  recent[bucket] = next.slice(0, 10);
  saveRecentValues(recent);
}

function renderDatalist(listEl, values) {
  listEl.innerHTML = values
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join('');
}

function readSshLogHistory() {
  try {
    const raw = sessionStorage.getItem(SSH_LOG_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveSshLogHistory(lines) {
  try {
    sessionStorage.setItem(SSH_LOG_HISTORY_KEY, JSON.stringify(lines));
  } catch (_) {
    /* ignore storage failures */
  }
}

const sshPanel = createLogPanel({
  output:     sshOutput,
  container:  document.getElementById('ssh-container'),
  counter:    document.getElementById('ssh-counter'),
  autoscroll: document.getElementById('ssh-autoscroll'),
  filter:     lineMatchesSshFilter,
});

let sshEvtSource = null;

for (const line of readSshLogHistory()) {
  sshPanel.push(line);
}
saveSshLogHistory(sshPanel.allLines);

const originalSshPush = sshPanel.push;
sshPanel.push = (line) => {
  originalSshPush(line);
  saveSshLogHistory(sshPanel.allLines);
};

document.getElementById('ssh-host').value = loadSavedField('host', document.getElementById('ssh-host').value);
document.getElementById('ssh-port').value = loadSavedField('port', document.getElementById('ssh-port').value);
document.getElementById('ssh-user').value = loadSavedField('username', document.getElementById('ssh-user').value);
document.getElementById('ssh-path').value = loadSavedField('log_path', document.getElementById('ssh-path').value);

const recentValues = readRecentValues();
renderDatalist(sshHostHistoryList, recentValues.host || []);
renderDatalist(sshUserHistoryList, recentValues.user || []);
renderDatalist(sshPathHistoryList, recentValues.path || []);

['ssh-host', 'ssh-port', 'ssh-user', 'ssh-path'].forEach((id) => {
  document.getElementById(id).addEventListener('input', persistCurrentFormValues);
});

function setSshStatus(state, text) {
  sshStatus.className = `status-${state}`;
  const labels = { connecting: 'Connecting…', connected: 'Connected', error: 'Disconnected' };
  sshStatus.textContent = text ?? labels[state] ?? state;
}

function showForm(show) {
  sshForm.hidden = !show;
  sshToolbar.hidden = show;
}

function closeStream() {
  if (sshEvtSource) {
    sshEvtSource.close();
    sshEvtSource = null;
  }
}

function openStream() {
  closeStream();
  sshEvtSource = new EventSource('/ssh/stream');
  sshEvtSource.onmessage = (event) => sshPanel.push(event.data);
  sshEvtSource.addEventListener('status', () => setSshStatus('connected', 'Connected'));
  sshEvtSource.addEventListener('error', (event) => {
    // Server-sent error frame carries a message; transport drops do not.
    if (event.data) setSshStatus('error', event.data);
  });
  sshEvtSource.onerror = () => setSshStatus('error');
}

sshForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  sshFormError.textContent = '';
  btnConnect.disabled = true;
  setSshStatus('connecting', 'Connecting…');

  const body = {
    host:     document.getElementById('ssh-host').value.trim(),
    port:     Number(document.getElementById('ssh-port').value),
    username: document.getElementById('ssh-user').value.trim(),
    password: sshPass.value,
    log_path: document.getElementById('ssh-path').value.trim(),
  };

  try {
    persistCurrentFormValues();
    const res = await fetch('/ssh/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Connection failed.');
    }
    sshPass.value = '';                       // never keep the password in the DOM
    sshTarget.textContent = `— ${data.host} (${data.log_path})`;
    pushRecentValue('host', body.host);
    pushRecentValue('user', body.username);
    pushRecentValue('path', body.log_path);
    const updatedRecent = readRecentValues();
    renderDatalist(sshHostHistoryList, updatedRecent.host || []);
    renderDatalist(sshUserHistoryList, updatedRecent.user || []);
    renderDatalist(sshPathHistoryList, updatedRecent.path || []);
    showForm(false);
    setSshStatus('connected', 'Connected');
    openStream();
  } catch (err) {
    sshFormError.textContent = err.message;
    setSshStatus('error', 'Disconnected');
  } finally {
    btnConnect.disabled = false;
  }
});

btnDisconnect.addEventListener('click', async () => {
  closeStream();
  try {
    await fetch('/ssh/disconnect', { method: 'POST' });
  } catch (_) {
    /* ignore network errors while tearing down */
  }
  sshTarget.textContent = '';
  setSshStatus('connecting', 'Not connected');
  showForm(true);
});

// Reveal the form again to point at a different host/path, then Connect to
// reconnect (the backend tears down the previous session automatically).
btnChange.addEventListener('click', () => showForm(true));

btnPauseSsh.addEventListener('click', () => {
  const paused = sshPanel.togglePaused();
  btnPauseSsh.textContent = paused ? 'Resume' : 'Pause';
  btnPauseSsh.classList.toggle('active', paused);
});

btnClearSsh.addEventListener('click', () => {
  sshPanel.clear();
  saveSshLogHistory([]);
});

sshSearch.addEventListener('input', () => sshPanel.rebuild());

btnDownloadSsh.addEventListener('click', () => {
  const visible = sshPanel.allLines.filter(lineMatchesSshFilter);
  if (!visible.length) return;
  const today = new Date().toISOString().slice(0, 10);
  const slug = sshSearch.value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 40);
  downloadLines(visible, `remote-ssh-${today}${slug ? '-' + slug : ''}.log`);
});

enableTokenFilter(sshOutput, sshSearch);
