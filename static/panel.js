'use strict';

// Generic streaming log panel shared by the local rsyslog and remote SSH views.
// The caller feeds raw lines via push(); the panel handles rendering (through
// formatLine from format.js), trimming, the line counter, pause/resume, and
// auto-scroll. An optional `filter` predicate hides non-matching lines from the
// DOM without dropping them from the buffer (used only by the local view).

const DEFAULT_MAX_LINES = 10000;

function createLogPanel({ output, container, counter, autoscroll,
                          maxLines = DEFAULT_MAX_LINES, filter = null,
                          counterLabel = null }) {
  const allLines = [];
  const pauseBuffer = [];
  let paused = false;

  const matches = (line) => !filter || filter(line);

  function renderLine(raw) {
    if (!matches(raw)) return;
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = formatLine(raw);
    output.appendChild(div);
    while (output.children.length > maxLines) {
      output.removeChild(output.firstChild);
    }
    if (autoscroll.checked) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function updateCounter() {
    const n = output.children.length;
    counter.textContent = counterLabel ? counterLabel(n) : `${n} line${n !== 1 ? 's' : ''}`;
  }

  function record(line) {
    if (allLines.length >= maxLines) {
      allLines.splice(0, Math.floor(maxLines / 4));
    }
    allLines.push(line);
    renderLine(line);
  }

  function push(line) {
    if (paused) {
      pauseBuffer.push(line);
      return;
    }
    record(line);
    updateCounter();
  }

  function flushBuffer() {
    for (const line of pauseBuffer) record(line);
    pauseBuffer.length = 0;
    updateCounter();
  }

  function setPaused(value) {
    paused = value;
    if (!paused) flushBuffer();
  }

  function togglePaused() {
    setPaused(!paused);
    return paused;
  }

  function rebuild() {
    output.innerHTML = '';
    for (const line of allLines) renderLine(line);
    updateCounter();
  }

  function clear() {
    allLines.length = 0;
    pauseBuffer.length = 0;
    output.innerHTML = '';
    updateCounter();
  }

  return { push, togglePaused, setPaused, rebuild, clear, allLines };
}
