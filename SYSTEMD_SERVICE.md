# Running rsyslog + SSH Logs as a systemd Service

This guide explains how to install the dashboard as a Linux `systemd` service so it can be managed with `systemctl` and start automatically after reboot.

## Assumptions

- The server uses `systemd`.
- Python 3.11 or newer is installed.
- The project will run from `/opt/rsyslog-live-viewer`.
- The service will run as `www-data`.
- The dashboard will listen on port `8080`.
- The local rsyslog file is `/var/log/lab-rsyslog.log`.

Adjust the paths, user, group, or port if your environment is different.

## 1. Copy the Project to `/opt`

From the project directory:

```bash
sudo cp -r . /opt/rsyslog-live-viewer
sudo chown -R www-data:www-data /opt/rsyslog-live-viewer
```

## 2. Create the Python Virtual Environment

Create the virtual environment as the same user that will run the service:

```bash
sudo -u www-data python3 -m venv /opt/rsyslog-live-viewer/.venv
sudo -u www-data /opt/rsyslog-live-viewer/.venv/bin/pip install -r /opt/rsyslog-live-viewer/requirements.txt
```

## 3. Install the Service File

This repository includes a ready-to-use service file at:

```text
systemd/rsyslog-live-viewer.service
```

Install it into the systemd service directory:

```bash
sudo cp /opt/rsyslog-live-viewer/systemd/rsyslog-live-viewer.service /etc/systemd/system/
```

The service file should look like this:

```ini
[Unit]
Description=rsyslog + SSH Logs viewer (FastAPI/uvicorn)
After=network.target rsyslog.service
Wants=rsyslog.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/rsyslog-live-viewer
ExecStart=/opt/rsyslog-live-viewer/.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8080 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Give the service user read access to /var/log files on Ubuntu
SupplementaryGroups=adm syslog

[Install]
WantedBy=multi-user.target
```

## 4. Enable and Start the Service

Reload systemd, enable the service at boot, and start it now:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rsyslog-live-viewer
```

## 5. Check the Service Status

Use:

```bash
sudo systemctl status rsyslog-live-viewer
```

Follow live service logs with:

```bash
sudo journalctl -u rsyslog-live-viewer -f
```

The app should be available at:

```text
http://<server-ip>:8080/
```

## 6. Restart or Stop the Service

Restart after code or configuration changes:

```bash
sudo systemctl restart rsyslog-live-viewer
```

Stop the service:

```bash
sudo systemctl stop rsyslog-live-viewer
```

Start it again:

```bash
sudo systemctl start rsyslog-live-viewer
```

## 7. Updating the Application

After changing files in your working copy, copy the updated project files back to `/opt`:

```bash
sudo rsync -av --delete --exclude '.venv' --exclude 'saved_logs' ./ /opt/rsyslog-live-viewer/
sudo chown -R www-data:www-data /opt/rsyslog-live-viewer
```

If dependencies changed, reinstall them:

```bash
sudo -u www-data /opt/rsyslog-live-viewer/.venv/bin/pip install -r /opt/rsyslog-live-viewer/requirements.txt
```

Restart the service:

```bash
sudo systemctl restart rsyslog-live-viewer
```

## 8. Log File Permissions

The service runs as `www-data` and includes:

```ini
SupplementaryGroups=adm syslog
```

This gives the service access to common Ubuntu log groups. If your log file uses different ownership or permissions, adjust the service user, supplementary groups, or log file permissions.

Check the log file permissions:

```bash
ls -l /var/log/lab-rsyslog.log
```

If rsyslog cannot write to the file, restart rsyslog after fixing ownership or configuration:

```bash
sudo systemctl restart rsyslog
```

## 9. Firewall

If the server firewall is enabled, allow port `8080`:

```bash
sudo ufw allow 8080/tcp
```

## 10. Disable or Remove the Service

Disable the service from starting at boot:

```bash
sudo systemctl disable rsyslog-live-viewer
```

Stop and remove the service file:

```bash
sudo systemctl stop rsyslog-live-viewer
sudo rm /etc/systemd/system/rsyslog-live-viewer.service
sudo systemctl daemon-reload
```

Optionally remove the installed project directory:

```bash
sudo rm -rf /opt/rsyslog-live-viewer
```

