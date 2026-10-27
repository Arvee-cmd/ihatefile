"""Short-lived storage for finished conversions. No database, nothing survives a restart."""
from __future__ import annotations

import secrets
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class StoredJob:
    id: str
    directory: Path
    output: Path
    filename: str
    media_type: str
    size: int
    created: float
    expires: float


class JobStore:
    def __init__(self, root: Path, ttl_seconds: int):
        self.root = root / "jobs"
        self.ttl = ttl_seconds
        self._jobs: dict[str, StoredJob] = {}
        self._expired: dict[str, float] = {}  # tombstones so clients get "expired" instead of "unknown"
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        """Remove anything left over from a previous process."""
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def new_workdir(self) -> tuple[str, Path]:
        job_id = secrets.token_urlsafe(32)  # 256 bits: unguessable, doubles as the access token
        d = self.root / job_id
        d.mkdir(mode=0o700)
        return job_id, d

    def commit(self, job_id: str, directory: Path, output: Path, filename: str, media_type: str) -> StoredJob:
        now = time.time()
        job = StoredJob(job_id, directory, output, filename, media_type, output.stat().st_size, now, now + self.ttl)
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> StoredJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job and job.expires <= time.time():
            self.delete(job_id, expired=True)
            return None
        return job

    def was_expired(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._expired

    def delete(self, job_id: str, expired: bool = False) -> bool:
        with self._lock:
            job = self._jobs.pop(job_id, None)
            if expired:
                self._expired[job_id] = time.time()
        if job is None:
            return False
        shutil.rmtree(job.directory, ignore_errors=True)
        return True

    def discard_workdir(self, directory: Path) -> None:
        shutil.rmtree(directory, ignore_errors=True)

    def sweep(self) -> int:
        now = time.time()
        with self._lock:
            due = [j for j, v in self._jobs.items() if v.expires <= now]
            for stale in [k for k, t in self._expired.items() if now - t > 3600]:
                del self._expired[stale]
        for job_id in due:
            self.delete(job_id, expired=True)
        # Orphaned working directories (e.g. a worker crashed): older than ttl + 60s and unknown to us.
        for d in self.root.iterdir():
            try:
                if d.name not in self._jobs and now - d.stat().st_mtime > self.ttl + 60:
                    shutil.rmtree(d, ignore_errors=True)
            except OSError:
                pass
        return len(due)

    def count(self) -> int:
        with self._lock:
            return len(self._jobs)
