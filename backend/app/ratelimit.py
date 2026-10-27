"""Tiny in-memory limiter for anonymous traffic: requests per minute + one conversion at a time per client."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._active: set[str] = set()
        self._lock = threading.Lock()

    def check(self, client: str) -> float | None:
        """Returns None if allowed, else seconds to wait."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[client]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return max(1.0, 60 - (now - q[0]))
            q.append(now)
            if len(self._hits) > 10_000:  # bound memory
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > 60]:
                    del self._hits[k]
            return None

    def acquire(self, client: str) -> bool:
        with self._lock:
            if client in self._active:
                return False
            self._active.add(client)
            return True

    def release(self, client: str) -> None:
        with self._lock:
            self._active.discard(client)
