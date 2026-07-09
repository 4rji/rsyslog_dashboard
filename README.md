# rsyslog Live Viewer

A lightweight web app for viewing rsyslog messages in real time. New log lines are streamed to connected browsers via Server-Sent Events. Each browser session starts empty and shows only logs that arrive after the page was opened.

## What it does

- Follows `/var/log/lab-rsyslog.log` in real time (equivalent to `tail -n 0 -F`)
- Pushes new lines to all connected browsers instantly via SSE
- Each browser session keeps its own in-memory log list — refreshing the page resets it
- Saves every new line to `./saved_logs/lab-rsyslog-YYYY-MM-DD.log` (one file per day)
- Provides a `/history` page showing the full current day's saved log
- Provides a `/download/today` endpoint to download today's saved log file
- Highlights keywords: `failed`, `error`, `denied`, `accepted`, `sudo`, `ssh`, `root`

## rsyslog Configuration

Add a rule to `/etc/rsyslog.d/99-lab.conf` (or directly to `/etc/rsyslog.conf`) to write to the log file this app reads:

```
# Write all syslog messages to the lab viewer file
*.*    /var/log/lab-rsyslog.log
```

Or to capture only specific facilities:

```
local0.*    /var/log/lab-rsyslog.log
auth,authpriv.*    /var/log/lab-rsyslog.log
```

After editing the rsyslog config:

```bash
sudo systemctl restart rsyslog
sudo touch /var/log/lab-rsyslog.log
sudo chmod 644 /var/log/lab-rsyslog.log
```

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

## Accessing the app

| URL | Description |
|-----|-------------|
| `http://<server-ip>:8080/` | Live viewer (starts empty) |
| `http://<server-ip>:8080/history` | Today's full saved log |
| `http://<server-ip>:8080/download/today` | Download today's log file |

## Live view vs history

**Live view (`/`):** When you open this page, the log area is empty. You will only see log lines that arrive *after* you opened the page. If you refresh the page, your view resets and starts empty again. Each open browser tab maintains its own independent session.

**History view (`/history`):** Shows the entire contents of today's saved log file. This page is allowed to show old logs because it is a separate historical view, not a live session.

## Saved logs

Every log line received by the app is appended to:

```
./saved_logs/lab-rsyslog-YYYY-MM-DD.log
```

One file is created per day. The `saved_logs/` directory is created automatically on startup. Files are retained indefinitely — add a cron job or logrotate rule if you need automatic cleanup.

## File structure

```
rsyslog-live-viewer/
├── app.py                          # FastAPI backend
├── templates/
│   ├── index.html                  # Live viewer page
│   └── history.html                # Historical log page
├── static/
│   ├── style.css                   # Dark theme + keyword colors
│   └── app.js                      # SSE client, controls, highlighting
├── saved_logs/                     # Auto-created; daily log archives
├── requirements.txt
├── README.md
└── systemd/
    └── rsyslog-live-viewer.service
```
