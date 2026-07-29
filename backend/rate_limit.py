"""Small bounded in-process rate limiter for public endpoints.

The production container defaults to one Gunicorn worker, so this provides a
useful first line of defense without another service. A reverse-proxy or Redis
limit should still be used when the application is scaled to multiple workers.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict, deque
from functools import wraps
from typing import Callable

from flask import jsonify, request


_MAX_BUCKETS = 10_000
_LOCK = threading.Lock()
_BUCKETS: OrderedDict[str, deque[float]] = OrderedDict()


def _client_ip() -> str:
    return (request.remote_addr or "unknown").strip()[:64]


def rate_limit(
    scope: str,
    *,
    limit: int,
    window_seconds: int,
    identity: Callable[[], str] | None = None,
    bypass: Callable[[], bool] | None = None,
):
    """Limit requests per client and optional endpoint-specific identity."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if bypass is not None and bypass():
                return fn(*args, **kwargs)

            suffix = (identity() if identity else "").strip().lower()[:128]
            bucket_key = f"{scope}:{_client_ip()}:{suffix}"
            now = time.monotonic()
            cutoff = now - window_seconds

            with _LOCK:
                bucket = _BUCKETS.setdefault(bucket_key, deque())
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()

                if len(bucket) >= limit:
                    retry_after = max(1, int(window_seconds - (now - bucket[0])))
                    response = jsonify({"msg": "Too many requests. Please try again later."})
                    response.status_code = 429
                    response.headers["Retry-After"] = str(retry_after)
                    return response

                bucket.append(now)
                _BUCKETS.move_to_end(bucket_key)
                while len(_BUCKETS) > _MAX_BUCKETS:
                    _BUCKETS.popitem(last=False)

            return fn(*args, **kwargs)

        return wrapper

    return decorator
