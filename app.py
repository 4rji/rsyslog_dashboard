import asyncio
import sys
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

import aiofiles
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

LOG_SOURCE = Path("/var/log/lab-rsyslog.log")
SAVED_LOGS_DIR = Path("saved_logs")

# Global set of per-client queues; all access happens in the same event loop thread
active_queues: set[asyncio.Queue] = set()


async def broadcast(line: str) -> None:
    dead: set[asyncio.Queue] = set()
    for q in active_queues:
        try:
            q.put_nowait(line)
        except asyncio.QueueFull:
            dead.add(q)
    active_queues.difference_update(dead)


async def save_line(line: str) -> None:
    today = date.today().strftime("%Y-%m-%d")
    path = SAVED_LOGS_DIR / f"lab-rsyslog-{today}.log"
    async with aiofiles.open(path, "a", encoding="utf-8") as f:
        await f.write(line + "\n")


async def file_follower() -> None:
    """Single shared task: follows LOG_SOURCE and fans out to all client queues."""
    try:
        LOG_SOURCE.touch(exist_ok=True)
    except PermissionError:
        if not LOG_SOURCE.exists():
            print(
                f"[ERROR] Cannot read or create {LOG_SOURCE}. "
                "Check that the file exists and is readable by this process.",
                file=sys.stderr,
            )

    last_inode: int | None = None
    last_size: int = 0
    fh = None
    partial: str = ""

    try:
        while True:
            try:
                stat = LOG_SOURCE.stat()
                current_inode = stat.st_ino
                current_size = stat.st_size
            except FileNotFoundError:
                # File deleted mid-run (rotation in progress); wait and retry
                if fh:
                    fh.close()
                    fh = None
                last_inode = None
                await asyncio.sleep(0.5)
                continue

            rotation_detected = (
                last_inode is not None and current_inode != last_inode
            ) or (current_size < last_size)

            if fh is None or rotation_detected:
                if fh:
                    fh.close()
                fh = open(LOG_SOURCE, "r", encoding="utf-8", errors="replace")
                if not rotation_detected:
                    # First open: seek to end so we only emit NEW lines
                    fh.seek(0, 2)
                # After rotation: start from beginning of the new file
                last_inode = current_inode
                partial = ""

            last_size = current_size

            while chunk := fh.readline():
                partial += chunk
                if partial.endswith("\n"):
                    clean = partial.rstrip("\n").replace("\n", " ")
                    if clean:
                        await broadcast(clean)
                        await save_line(clean)
                    partial = ""

            await asyncio.sleep(0.1)

    except asyncio.CancelledError:
        if fh:
            fh.close()
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    SAVED_LOGS_DIR.mkdir(exist_ok=True)
    task = asyncio.create_task(file_follower())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/stream")
async def stream(request: Request):
    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    active_queues.add(queue)

    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    line = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {line}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except (GeneratorExit, asyncio.CancelledError):
            pass
        finally:
            active_queues.discard(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/history", response_class=HTMLResponse)
async def history(request: Request):
    today = date.today().strftime("%Y-%m-%d")
    path = SAVED_LOGS_DIR / f"lab-rsyslog-{today}.log"
    try:
        async with aiofiles.open(path, "r", encoding="utf-8", errors="replace") as f:
            content = await f.read()
    except FileNotFoundError:
        content = "(No logs saved today yet)"
    return templates.TemplateResponse(
        request,
        "history.html",
        {"content": content, "date": today},
    )


@app.get("/download/today")
async def download_today():
    today = date.today().strftime("%Y-%m-%d")
    path = SAVED_LOGS_DIR / f"lab-rsyslog-{today}.log"
    if not path.exists():
        return HTMLResponse("No log file for today.", status_code=404)
    return FileResponse(
        path,
        media_type="text/plain",
        filename=f"lab-rsyslog-{today}.log",
    )
