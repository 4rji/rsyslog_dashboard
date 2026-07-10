"""Remote SSH log streaming.

Each browser gets its own SSH session (keyed by an opaque cookie token). A
session opens an ``asyncssh`` connection, runs ``tail -F`` on the requested log
file, and fans new lines out to every SSE subscriber attached to that session —
the same broadcast pattern the local file follower uses in ``app.py``.

Credentials arrive only in the connect request and live solely in memory for the
duration of the connection: they are never logged, returned, or persisted.
"""

import asyncio
import re
import secrets
import shlex
from dataclasses import dataclass
from typing import Literal

import asyncssh

# Seconds to wait for the TCP + SSH handshake before giving up.
CONNECT_TIMEOUT = 15.0
# Close a session this long after its last viewer disconnects, so a closed
# browser does not leave an SSH connection running forever.
IDLE_CLOSE_DELAY = 240.0
# Bound each subscriber queue so a stalled client cannot grow memory unbounded.
QUEUE_MAXSIZE = 1000
DEFAULT_LOG_PATH = "/var/log/messages"

# Absolute path made of safe characters only. Combined with shlex.quote below,
# this blocks shell metacharacters / command injection through the log path.
_SAFE_PATH_RE = re.compile(r"^/[A-Za-z0-9._/-]+$")

ErrorKind = Literal["validation", "auth", "timeout", "connect", "unknown"]

# (event_name, data) tuples pushed onto subscriber queues.
# event_name is "line" for a log line, or "status"/"error" for control frames.
Payload = tuple[str, str]


class SshError(Exception):
    """A user-facing SSH failure with a machine-readable ``kind``."""

    def __init__(self, kind: ErrorKind, message: str) -> None:
        super().__init__(message)
        self.kind: ErrorKind = kind
        self.message = message


@dataclass(frozen=True)
class ConnectionRequest:
    host: str
    port: int
    username: str
    password: str
    log_path: str


def parse_connection_request(data: object) -> ConnectionRequest:
    """Validate raw request data into a ConnectionRequest, or raise SshError."""
    if not isinstance(data, dict):
        raise SshError("validation", "Invalid request body.")

    host = str(data.get("host", "")).strip()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    log_path = str(data.get("log_path") or DEFAULT_LOG_PATH).strip()

    if not host:
        raise SshError("validation", "Host or IP address is required.")
    if not username:
        raise SshError("validation", "Username is required.")
    if not password:
        raise SshError("validation", "Password is required.")

    try:
        port = int(data.get("port", 22))
    except (TypeError, ValueError):
        raise SshError("validation", "Port must be a number.")
    if not 1 <= port <= 65535:
        raise SshError("validation", "Port must be between 1 and 65535.")

    if not _SAFE_PATH_RE.match(log_path):
        raise SshError(
            "validation",
            "Log path must be an absolute path without special characters.",
        )

    return ConnectionRequest(
        host=host,
        port=port,
        username=username,
        password=password,
        log_path=log_path,
    )


class RemoteSession:
    """One SSH connection tailing one remote file, fanning lines to subscribers."""

    def __init__(self) -> None:
        self.host: str = ""
        self.log_path: str = ""
        self._subscribers: set[asyncio.Queue[Payload]] = set()
        self._conn: asyncssh.SSHClientConnection | None = None
        self._process: asyncssh.SSHClientProcess | None = None
        self._follower: asyncio.Task | None = None
        self._idle_closer: asyncio.Task | None = None
        self._closed = False
        # Set by SessionManager so the session can deregister itself on close.
        self.on_close = None

    async def open(self, request: ConnectionRequest) -> None:
        """Connect and start tailing. Raises SshError on any failure."""
        self.host = request.host
        self.log_path = request.log_path

        try:
            self._conn = await asyncio.wait_for(
                asyncssh.connect(
                    request.host,
                    port=request.port,
                    username=request.username,
                    password=request.password,
                    known_hosts=None,  # lab devices: accept unknown host keys
                ),
                timeout=CONNECT_TIMEOUT,
            )
        except asyncio.TimeoutError:
            raise SshError(
                "timeout",
                f"Timed out connecting to {request.host}:{request.port}.",
            )
        except asyncssh.PermissionDenied:
            raise SshError(
                "auth", "Authentication failed. Check the username and password."
            )
        except (OSError, asyncssh.Error) as exc:
            raise SshError("connect", f"Could not connect: {exc}")

        command = f"tail -F {shlex.quote(request.log_path)}"
        try:
            self._process = await self._conn.create_process(command)
        except asyncssh.Error as exc:
            await self._close_transport()
            raise SshError("connect", f"Could not start tail on the remote host: {exc}")

        self._follower = asyncio.create_task(self._follow())

    async def _follow(self) -> None:
        """Read tail output line by line and broadcast to subscribers."""
        assert self._process is not None
        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:  # EOF: remote process ended
                    if not self._closed:
                        await self._broadcast("error", "Remote log stream ended.")
                    break
                await self._broadcast("line", line.rstrip("\r\n"))
        except asyncio.CancelledError:
            raise
        except (OSError, asyncssh.Error) as exc:
            if not self._closed:
                await self._broadcast("error", f"Connection lost: {exc}")
        finally:
            await self.close()

    async def _broadcast(self, event: str, data: str) -> None:
        dead: set[asyncio.Queue[Payload]] = set()
        for queue in self._subscribers:
            try:
                queue.put_nowait((event, data))
            except asyncio.QueueFull:
                dead.add(queue)
        self._subscribers.difference_update(dead)

    def subscribe(self) -> asyncio.Queue[Payload]:
        queue: asyncio.Queue[Payload] = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
        self._subscribers.add(queue)
        if self._idle_closer is not None:
            self._idle_closer.cancel()
            self._idle_closer = None
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Payload]) -> None:
        self._subscribers.discard(queue)
        if not self._subscribers and not self._closed and self._idle_closer is None:
            self._idle_closer = asyncio.create_task(self._idle_close())

    async def _idle_close(self) -> None:
        try:
            await asyncio.sleep(IDLE_CLOSE_DELAY)
        except asyncio.CancelledError:
            return
        if not self._subscribers:
            await self.close()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._idle_closer is not None:
            self._idle_closer.cancel()
            self._idle_closer = None
        # Closing the transport ends the follower's read loop on its own, so we
        # avoid cancelling (and awaiting) the follower from within itself.
        await self._close_transport()
        if self.on_close is not None:
            self.on_close()

    async def _close_transport(self) -> None:
        if self._process is not None:
            try:
                self._process.terminate()
            except (OSError, asyncssh.Error):
                pass
            self._process = None
        if self._conn is not None:
            self._conn.close()
            try:
                await self._conn.wait_closed()
            except (OSError, asyncssh.Error):
                pass
            self._conn = None


class SessionManager:
    """Registry of per-browser RemoteSessions keyed by opaque token."""

    def __init__(self) -> None:
        self._sessions: dict[str, RemoteSession] = {}

    async def connect(self, token: str | None, request: ConnectionRequest) -> str:
        """Open a new session, replacing any existing one for this token.

        Returns the new session token. Raises SshError on failure.
        """
        if token:
            await self._remove(token)

        new_token = secrets.token_urlsafe(32)
        session = RemoteSession()
        session.on_close = lambda: self._sessions.pop(new_token, None)
        await session.open(request)  # raises SshError before we register anything
        self._sessions[new_token] = session
        return new_token

    def get(self, token: str | None) -> RemoteSession | None:
        if not token:
            return None
        return self._sessions.get(token)

    def describe(self, token: str | None) -> dict[str, str] | None:
        session = self.get(token)
        if session is None:
            return None
        return {
            "host": session.host,
            "log_path": session.log_path,
        }

    async def disconnect(self, token: str | None) -> None:
        if token:
            await self._remove(token)

    async def _remove(self, token: str) -> None:
        session = self._sessions.pop(token, None)
        if session is not None:
            await session.close()

    async def close_all(self) -> None:
        for session in list(self._sessions.values()):
            await session.close()
        self._sessions.clear()
