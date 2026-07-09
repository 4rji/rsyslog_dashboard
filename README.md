# rsyslog Live Viewer

A lightweight web app for viewing rsyslog messages in real time. New log lines are streamed to connected browsers via Server-Sent Events. Each browser session starts empty and shows only logs that arrive after the page was opened.

## Features

### Backend

- Follows `/var/log/lab-rsyslog.log` in real time (equivalent to `tail -n 0 -F`)
- Handles log rotation transparently (detects inode changes and truncation, reopens the file)
- Pushes new lines to all connected browsers instantly via SSE (`/stream`)
- Saves every new line to `./saved_logs/lab-rsyslog-YYYY-MM-DD.log` (one file per day)
- Provides a `/history` page showing the full current day's saved log
- Provides a `/download/today` endpoint to download today's saved log file

### Live view UI (`/`)

- **Pause / Resume** — freezes the display; lines received while paused are buffered and flushed on resume
- **Clear** — empties the current session's log area
- **Auto-scroll** toggle — follows the newest line as it arrives
- **Filter box** — live text filter over the received lines (case-insensitive substring match); clearing the filter restores all lines
- **Double-click to filter** — double-clicking a highlighted token (IP, session ID, username, hostname) or any word drops it into the filter box
- **Download filtered** — downloads only the lines matching the current filter as a `.log` file (named after the filter term, e.g. `lab-rsyslog-2026-07-09-10.10.65.221.log`); with no filter it downloads the whole session
- **Line counter** — number of lines currently displayed
- **Connection status badge** — Connecting / Connected / Disconnected (SSE reconnects automatically)
- **Structured coloring** — each line is parsed and its parts get their own color: timestamp (dim gray), hostname (purple), IPv4 addresses (blue), session IDs like `(ID d03716f428)` (yellow), usernames after `User` (green)
- **Keyword highlighting** — colorizes `failed`, `error`, `denied`, `accepted`, `sudo`, `ssh`, `root`
- Keeps at most 10,000 lines in memory per browser tab; older lines are dropped

### History view UI (`/history`)

- Shows the entire contents of today's saved log file (static snapshot; refresh for newer entries)
- **Filter box** — same case-insensitive live filter as the live view, with a `shown / total lines` counter
- **Double-click to filter** and **Download filtered** — same behavior as the live view, applied to today's full saved log
- Link to download today's complete log file

## rsyslog Configuration

The recommended setup captures **all messages received from remote devices** (anything arriving over the network) while excluding the server's own local noise (systemd, cron, etc.):

```bash
sudo tee /etc/rsyslog.d/30-lab-dashboard.conf <<'EOF'
if $fromhost-ip != '127.0.0.1' then {
    action(type="omfile"
           file="/var/log/lab-rsyslog.log"
           fileCreateMode="0644"
           fileOwner="syslog"
           fileGroup="adm")
}
EOF
sudo systemctl restart rsyslog
```

Local messages originate from `127.0.0.1`, so this filter matches only remote traffic. `fileCreateMode="0644"` makes the file world-readable so the dashboard can follow it without extra permissions.

Variants:

```
# Only one specific device, by the hostname it reports:
if $hostname == '00409DDE26B5' then { action(...) }

# Only one specific device, by source IP (more reliable than hostname):
if $fromhost-ip == '10.10.65.1' then { action(...) }

# Absolutely everything, including the server's own local logs:
*.* action(type="omfile" file="/var/log/lab-rsyslog.log" fileCreateMode="0644")
```

Notes:

- rsyslog only creates the file **when the first matching message arrives**. Use `sudo tail -F /var/log/lab-rsyslog.log` (capital `-F`) to wait for it to appear.
- Validate the config with `sudo rsyslogd -N1`.
- **Start rsyslog before the dashboard** (or make sure the file already exists with rsyslog-compatible ownership). If the dashboard starts first it creates an empty file owned by its own user, and rsyslog (running as the `syslog` user) will not be able to write to it. If that happens, `sudo rm /var/log/lab-rsyslog.log` and restart rsyslog.
- Do **not** replace the file with a symlink to `/var/log/syslog` — that file is `root:adm 640`, so the dashboard would not be able to read it.

## Installation

### Prerequisites

- Python 3.11 or newer
- pip

### Install dependencies

```bash
cd rsyslog-live-viewer
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Running manually

```bash
source .venv/bin/activate
uvicorn app:app --host 0.0.0.0 --port 8080
```

The app starts at `http://<server-ip>:8080`.

To run in the background with auto-reload during development:

```bash
uvicorn app:app --host 0.0.0.0 --port 8080 --reload
```

## Installing as a systemd service

1. Copy the project to a permanent location:

```bash
sudo cp -r . /opt/rsyslog-live-viewer
sudo chown -R www-data:www-data /opt/rsyslog-live-viewer
```

2. Create the virtual environment as the service user:

```bash
sudo -u www-data python3 -m venv /opt/rsyslog-live-viewer/.venv
sudo -u www-data /opt/rsyslog-live-viewer/.venv/bin/pip install -r /opt/rsyslog-live-viewer/requirements.txt
```

3. Install and enable the service:

```bash
sudo cp systemd/rsyslog-live-viewer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rsyslog-live-viewer
```

4. Check status:

```bash
sudo systemctl status rsyslog-live-viewer
sudo journalctl -u rsyslog-live-viewer -f
```

> **Note:** The service runs as `www-data` with `SupplementaryGroups=adm syslog` so it can read `/var/log/lab-rsyslog.log`. If your log file has different permissions, adjust the group accordingly.

## Endpoints

| URL | Description |
|-----|-------------|
| `http://<server-ip>:8080/` | Live viewer (starts empty) |
| `http://<server-ip>:8080/history` | Today's full saved log, with filter |
| `http://<server-ip>:8080/stream` | SSE stream of new log lines (used by the live view) |
| `http://<server-ip>:8080/download/today` | Download today's log file |

## Live view vs history

**Live view (`/`):** When you open this page, the log area is empty. You will only see log lines that arrive *after* you opened the page. If you refresh the page, your view resets and starts empty again. Each open browser tab maintains its own independent session.

**History view (`/history`):** Shows the entire contents of today's saved log file, so it includes lines received before you opened the page. It is a static snapshot — refresh to see newer entries.

## Saved logs

Every log line received by the app is appended to:

```
./saved_logs/lab-rsyslog-YYYY-MM-DD.log
```

One file is created per day. The `saved_logs/` directory is created automatically on startup. Files are **retained indefinitely** — the history page only displays today's file, but previous days remain on disk. Add a cron job or logrotate rule if you need automatic cleanup.

## File structure

```
rsyslog-live-viewer/
├── app.py                          # FastAPI backend: file follower, SSE fan-out, daily archiving
├── templates/
│   ├── index.html                  # Live viewer page
│   └── history.html                # Historical log page (with client-side filter)
├── static/
│   ├── style.css                   # Dark theme + token/keyword colors
│   ├── format.js                   # Shared line parsing/coloring, dblclick-to-filter, filtered download
│   └── app.js                      # SSE client, controls, filtering
├── saved_logs/                     # Auto-created; daily log archives
├── requirements.txt
├── README.md
└── systemd/
    └── rsyslog-live-viewer.service
```
