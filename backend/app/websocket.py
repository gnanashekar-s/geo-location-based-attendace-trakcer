"""
WebSocket handlers for the Geo-Attendance API.

Endpoints
─────────
  /ws/feed        – Admin real-time check-in event feed.
                    Subscribes to Redis pub/sub channel  ws:feed.
  /ws/approvals   – Live approval queue updates.
                    Subscribes to Redis pub/sub channel  ws:approvals.

Authentication
──────────────
  Both endpoints require a valid JWT passed as the query-parameter `token`.
  Example: ws://host/ws/feed?token=<access_token>

Connection lifecycle
────────────────────
  connect  → validate token → add to ConnectionManager
  message  → Redis pub/sub message arrives → broadcast to all subscribers
             of that channel
  disconnect → remove from ConnectionManager

The Redis pub/sub listener for each channel is a single background asyncio
task per channel, started lazily on the first connection and running for
the lifetime of the process.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError, jwt

from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Connection Manager
# ---------------------------------------------------------------------------


class ConnectionManager:
    """
    Tracks active WebSocket connections grouped by channel name.

    Thread-safety note
    ──────────────────
    FastAPI/Starlette run in a single asyncio event loop in production,
    so standard asyncio primitives are sufficient.  For multi-process
    deployments (multiple uvicorn workers), the Redis pub/sub listener
    ensures every process receives messages independently.
    """

    def __init__(self) -> None:
        # channel_name → set of connected WebSocket objects
        self._connections: dict[str, set[WebSocket]] = {}
        # channel_name → asyncio.Task (Redis listener)
        self._listener_tasks: dict[str, asyncio.Task] = {}

    # ── Connection management ──────────────────────────────────────────────

    async def connect(self, websocket: WebSocket, channel: str) -> None:
        """Accept the WebSocket and register it under *channel*."""
        await websocket.accept()
        self._connections.setdefault(channel, set()).add(websocket)
        logger.info(
            "WS connected to channel=%s  total=%d",
            channel,
            len(self._connections[channel]),
        )

    def disconnect(self, websocket: WebSocket, channel: str) -> None:
        """Remove *websocket* from the *channel* subscriber set."""
        channel_set = self._connections.get(channel, set())
        channel_set.discard(websocket)
        if not channel_set:
            self._connections.pop(channel, None)
        logger.info(
            "WS disconnected from channel=%s  remaining=%d",
            channel,
            len(channel_set),
        )

    # ── Broadcasting ───────────────────────────────────────────────────────

    async def broadcast(self, channel: str, message: str) -> None:
        """
        Send *message* to every WebSocket subscribed to *channel*.

        Dead connections are silently removed.
        """
        subscribers = list(self._connections.get(channel, set()))
        if not subscribers:
            return

        dead: list[WebSocket] = []
        for ws in subscribers:
            try:
                await ws.send_text(message)
            except Exception:  # noqa: BLE001
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws, channel)

    # ── Redis pub/sub listener ─────────────────────────────────────────────

    def ensure_listener(self, channel: str, redis_url: str) -> None:
        """
        Start a background asyncio task that listens on *channel* and calls
        broadcast() for every message.  Idempotent – safe to call repeatedly.
        """
        if channel in self._listener_tasks:
            task = self._listener_tasks[channel]
            if not task.done():
                return  # listener is still running

        task = asyncio.create_task(
            self._redis_listener(channel, redis_url),
            name=f"ws-listener:{channel}",
        )
        task.add_done_callback(
            lambda t: self._on_listener_done(t, channel, redis_url)
        )
        self._listener_tasks[channel] = task
        logger.info("Started Redis pub/sub listener for channel=%s", channel)

    def _on_listener_done(
        self, task: asyncio.Task, channel: str, redis_url: str
    ) -> None:
        """Restart the listener if it exited unexpectedly."""
        if task.cancelled():
            logger.info("Redis listener for channel=%s was cancelled", channel)
            return
        exc = task.exception()
        if exc:
            logger.error(
                "Redis listener for channel=%s crashed: %s – restarting", channel, exc
            )
            self._listener_tasks.pop(channel, None)
            # Re-schedule via call_soon_threadsafe from the running loop
            loop = asyncio.get_event_loop()
            if not loop.is_closed():
                loop.call_soon(self.ensure_listener, channel, redis_url)

    async def _redis_listener(self, channel: str, redis_url: str) -> None:
        """
        Continuously subscribe to *channel* on Redis and broadcast any
        received messages to all connected WebSocket clients.
        """
        while True:
            try:
                async with aioredis.from_url(
                    redis_url, decode_responses=True
                ) as r:
                    pubsub = r.pubsub()
                    await pubsub.subscribe(channel)
                    logger.info("Subscribed to Redis channel: %s", channel)

                    async for message in pubsub.listen():
                        if message["type"] != "message":
                            continue
                        data: str = message["data"]
                        await self.broadcast(channel, data)

            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Redis listener error on channel=%s: %s – reconnecting in 2s",
                    channel,
                    exc,
                )
                await asyncio.sleep(2)

    # ── Stats / introspection ──────────────────────────────────────────────

    def subscriber_count(self, channel: str) -> int:
        return len(self._connections.get(channel, set()))

    def all_channels(self) -> list[str]:
        return list(self._connections.keys())


# Module-level singleton shared across all requests in the same process
manager = ConnectionManager()

# ---------------------------------------------------------------------------
# JWT validation helper
# ---------------------------------------------------------------------------

CREDENTIALS_EXCEPTION_MSG = "Could not validate WebSocket credentials"


def _validate_token(token: str) -> Optional[dict]:
    """
    Decode and validate a JWT access token.

    Returns the payload dict on success, or None if the token is invalid.
    Supports both HS256 (secret key) and RS256 (public key) algorithms as
    configured in settings.
    """
    try:
        key = (
            settings.JWT_PUBLIC_KEY
            if settings.JWT_ALGORITHM == "RS256" and settings.JWT_PUBLIC_KEY
            else settings.JWT_SECRET
        )
        payload = jwt.decode(
            token,
            key,
            algorithms=[settings.JWT_ALGORITHM],
            options={"verify_aud": False},
        )
        return payload
    except JWTError as exc:
        logger.warning("WebSocket JWT validation failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# WebSocket endpoint: /ws/feed
# ---------------------------------------------------------------------------

FEED_CHANNEL = "ws:feed"


@router.websocket("/ws/feed")
async def ws_feed(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None, alias="token"),
) -> None:
    """
    Real-time check-in event feed for admin dashboards.

    On connect: validates the JWT, requires role in {admin, superadmin}.
    Pushes JSON messages published by the API or Celery workers on the
    Redis channel  ws:feed.

    Message shape (published by server):
      {
        "event": "check_in" | "check_out" | "geofence_breach" | ...,
        "user_id": "...",
        "user_name": "...",
        "timestamp": "ISO8601",
        ... (event-specific fields)
      }
    """
    # ── Authentication ─────────────────────────────────────────────────────
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    payload = _validate_token(token)
    if payload is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    role = payload.get("role", "")
    if role not in {"admin", "superadmin", "org_admin", "supervisor"}:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
        )
        logger.warning(
            "WebSocket /ws/feed: access denied for role=%s user=%s",
            role,
            payload.get("sub"),
        )
        return

    # ── Connect & subscribe ────────────────────────────────────────────────
    await manager.connect(websocket, FEED_CHANNEL)
    manager.ensure_listener(FEED_CHANNEL, settings.REDIS_URL)

    # Send an initial "connected" acknowledgement
    await websocket.send_text(
        json.dumps(
            {
                "event": "connected",
                "channel": FEED_CHANNEL,
                "message": "Subscribed to check-in feed",
            }
        )
    )

    try:
        # Keep the connection open; the listener task handles broadcasting.
        # We still need to receive (and discard) any client keep-alive pings.
        while True:
            data = await websocket.receive_text()
            # Optionally handle client → server messages (e.g. ping/pong)
            if data == "ping":
                await websocket.send_text(json.dumps({"event": "pong"}))

    except WebSocketDisconnect:
        manager.disconnect(websocket, FEED_CHANNEL)
        logger.info(
            "WS /ws/feed disconnected: user=%s", payload.get("sub")
        )
    except Exception as exc:
        logger.exception("Unexpected error in /ws/feed: %s", exc)
        manager.disconnect(websocket, FEED_CHANNEL)


# ---------------------------------------------------------------------------
# WebSocket endpoint: /ws/approvals
# ---------------------------------------------------------------------------

APPROVALS_CHANNEL = "ws:approvals"


@router.websocket("/ws/approvals")
async def ws_approvals(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None, alias="token"),
) -> None:
    """
    Live approval queue updates for managers and admins.

    On connect: validates the JWT, requires role in {manager, admin, superadmin}.
    Pushes JSON messages published when approval status changes.

    Message shape:
      {
        "event": "approval_submitted" | "approval_escalated" | "approval_resolved",
        "approval_id": "...",
        "user_id": "...",
        "user_name": "...",
        "status": "PENDING" | "APPROVED" | "REJECTED" | ...,
        "timestamp": "ISO8601"
      }
    """
    # ── Authentication ─────────────────────────────────────────────────────
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    payload = _validate_token(token)
    if payload is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    role = payload.get("role", "")
    if role not in {"manager", "admin", "superadmin", "org_admin", "supervisor"}:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        logger.warning(
            "WebSocket /ws/approvals: access denied for role=%s user=%s",
            role,
            payload.get("sub"),
        )
        return

    # ── Connect & subscribe ────────────────────────────────────────────────
    await manager.connect(websocket, APPROVALS_CHANNEL)
    manager.ensure_listener(APPROVALS_CHANNEL, settings.REDIS_URL)

    await websocket.send_text(
        json.dumps(
            {
                "event": "connected",
                "channel": APPROVALS_CHANNEL,
                "message": "Subscribed to approval queue",
            }
        )
    )

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"event": "pong"}))

    except WebSocketDisconnect:
        manager.disconnect(websocket, APPROVALS_CHANNEL)
        logger.info(
            "WS /ws/approvals disconnected: user=%s", payload.get("sub")
        )
    except Exception as exc:
        logger.exception("Unexpected error in /ws/approvals: %s", exc)
        manager.disconnect(websocket, APPROVALS_CHANNEL)
