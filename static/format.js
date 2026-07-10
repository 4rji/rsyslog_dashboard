'use strict';

// Shared log-line formatting for the live views (local + remote SSH) and the
// history page. Recognized tokens (timestamp, hostname, IP, session ID,
// username) get their own color; the clickable ones carry the .tok class and
// enableTokenFilter() wires double-click on them to a search input.
//
// Colors are applied purely for display — the original log text is never
// altered, only wrapped in <span> elements in the browser.

// Keyword categories → CSS class. Order matters: earlier rules win on overlap.
const KEYWORD_RULES = [
  ['kw-error', ['error', 'err', 'errors', 'failed', 'fail', 'failure', 'denied',
                'deny', 'critical', 'fatal', 'panic', 'refused', 'unreachable',
                'timeout', 'timed']],
  ['kw-warn', ['warning', 'warn']],
  ['kw-auth', ['authentication', 'authenticated', 'auth', 'login', 'logout',
               'logged', 'password', 'sudo', 'sshd', 'ssh', 'session', 'pam',
               'invalid', 'unauthorized']],
  ['kw-net', ['interface', 'link', 'carrier', 'dhcp', 'dhclient', 'dhcpd',
              'networkmanager', 'bridge', 'vlan', 'ppp', 'tunnel', 'route']],
  ['kw-accepted', ['accepted', 'success', 'succeeded', 'established', 'connected']],
  ['kw-root', ['root']],
];

const KEYWORD_REGEXES = KEYWORD_RULES.map(
  ([cls, words]) => [cls, new RegExp(`\\b(${words.join('|')})\\b`, 'gi')]
);

// ISO-8601 timestamp + hostname prefix (local rsyslog format).
// "2026-07-09T19:42:54-05:00 00409DDE26B5 "
const TS_HOST_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)\s+(\S+)\s+/;
// Traditional syslog timestamp + hostname prefix (remote /var/log/messages).
// "Jul  9 19:42:54 myhost "
const SYSLOG_TS_HOST_RE = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+/;

// IPv4 address | "(ID d03716f428)" | "User adminradius" (case-sensitive on purpose)
const TOKEN_RE = /(\b\d{1,3}(?:\.\d{1,3}){3}\b)|\(ID ([^\s)]+)\)|\bUser (\S+)/g;
const TOK_TITLE = 'title="Double-click to filter"';

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightKeywords(text) {
  let html = escapeHtml(text);
  for (const [cls, re] of KEYWORD_REGEXES) {
    html = html.replace(re, `<span class="${cls}">$1</span>`);
  }
  return html;
}

function formatLine(raw) {
  let html = '';
  let rest = raw;

  const head = raw.match(TS_HOST_RE) || raw.match(SYSLOG_TS_HOST_RE);
  if (head) {
    html += `<span class="log-ts">${escapeHtml(head[1])}</span> `;
    html += `<span class="tok log-host" ${TOK_TITLE}>${escapeHtml(head[2])}</span> `;
    rest = raw.slice(head[0].length);
  }

  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(rest)) !== null) {
    html += highlightKeywords(rest.slice(last, m.index));
    if (m[1]) {
      html += `<span class="tok log-ip" ${TOK_TITLE}>${escapeHtml(m[1])}</span>`;
    } else if (m[2]) {
      html += `(ID <span class="tok log-id" ${TOK_TITLE}>${escapeHtml(m[2])}</span>)`;
    } else {
      html += `User <span class="tok log-user" ${TOK_TITLE}>${escapeHtml(m[3])}</span>`;
    }
    last = m.index + m[0].length;
  }
  html += highlightKeywords(rest.slice(last));
  return html;
}

// Client-side download of the currently filtered lines as a .log file.
function downloadLines(lines, filename) {
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function filteredFilename(date, term) {
  const slug = term.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 40);
  return `lab-rsyslog-${date}${slug ? '-' + slug : ''}.log`;
}

// Double-click on a token (or any word) drops it into the search input and
// fires its 'input' event so the page's existing filter logic re-runs.
function enableTokenFilter(container, searchInput) {
  container.addEventListener('dblclick', (event) => {
    const tok = event.target.closest('.tok');
    const value = tok
      ? tok.textContent
      : (window.getSelection()?.toString().trim() ?? '');
    if (!value) return;
    searchInput.value = value;
    searchInput.dispatchEvent(new Event('input'));
    window.getSelection()?.removeAllRanges();
  });
}
