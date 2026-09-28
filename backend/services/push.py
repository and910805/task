"""Apple Push Notification service (APNs) for the TaskGo iOS app.

Disabled unless every setting below is present in the environment; nothing is
ever read from code or the database:

* ``APNS_KEY_ID``, ``APNS_TEAM_ID``, ``APNS_BUNDLE_ID`` (e.g. online.kuanlin.taskgo)
* ``APNS_PRIVATE_KEY`` (the .p8 contents) or ``APNS_KEY_PATH`` (path to the .p8)
* ``APNS_USE_SANDBOX=1`` for development builds

Tokens are sent over HTTP/2 with a short-lived ES256 provider token. Device
tokens Apple reports as invalid are deleted.
"""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable

import jwt
from flask import current_app

_PROVIDER_TOKEN_TTL = 50 * 60  # Apple accepts tokens up to 60 minutes old.
_token_lock = threading.Lock()
_token_cache: dict[str, object] = {}
_pool: ThreadPoolExecutor | None = None
INVALID_TOKEN_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}


def _private_key() -> str | None:
    inline = os.environ.get("APNS_PRIVATE_KEY")
    if inline and inline.strip():
        return inline.replace("\\n", "\n").strip()
    path = (os.environ.get("APNS_KEY_PATH") or "").strip()
    if path and os.path.isfile(path):
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip()
    return None


def apns_configured() -> bool:
    required = ("APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID")
    return all((os.environ.get(name) or "").strip() for name in required) and _private_key() is not None


def _provider_token() -> str:
    with _token_lock:
        cached = _token_cache.get("token")
        issued = float(_token_cache.get("issued_at") or 0)
        if cached and time.time() - issued < _PROVIDER_TOKEN_TTL:
            return str(cached)
        issued_at = int(time.time())
        token = jwt.encode(
            {"iss": os.environ["APNS_TEAM_ID"].strip(), "iat": issued_at},
            _private_key(),
            algorithm="ES256",
            headers={"kid": os.environ["APNS_KEY_ID"].strip()},
        )
        _token_cache.update({"token": token, "issued_at": issued_at})
        return token


def _host() -> str:
    sandbox = (os.environ.get("APNS_USE_SANDBOX") or "").strip().lower() in {"1", "true", "yes", "on"}
    return "https://api.sandbox.push.apple.com" if sandbox else "https://api.push.apple.com"


def build_payload(title: str, body: str, data: dict | None = None) -> dict:
    payload: dict = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}}
    for key, value in (data or {}).items():
        if key != "aps" and value is not None:
            payload[key] = value
    return payload


def send_to_tokens(tokens: Iterable[str], payload: dict, *, client=None) -> list[str]:
    """Send one payload to device tokens; returns tokens Apple rejected as invalid."""
    import httpx

    invalid: list[str] = []
    headers = {
        "authorization": f"bearer {_provider_token()}",
        "apns-topic": os.environ["APNS_BUNDLE_ID"].strip(),
        "apns-push-type": "alert",
        "apns-priority": "10",
    }
    own_client = client is None
    client = client or httpx.Client(http2=True, timeout=10.0)
    try:
        for token in tokens:
            try:
                response = client.post(f"{_host()}/3/device/{token}", json=payload, headers=headers)
            except httpx.HTTPError as exc:
                current_app.logger.warning("APNs request failed: %s", type(exc).__name__)
                continue
            if response.status_code == 200:
                continue
            reason = ""
            try:
                reason = (response.json() or {}).get("reason", "")
            except ValueError:
                pass
            if response.status_code == 410 or reason in INVALID_TOKEN_REASONS:
                invalid.append(token)
            else:
                current_app.logger.warning("APNs rejected a push: %s %s", response.status_code, reason)
    finally:
        if own_client:
            client.close()
    return invalid


def push_to_users(user_ids: Iterable[int], title: str, body: str, data: dict | None = None) -> None:
    """Queue a push to every registered device of the given users (no-op if unconfigured)."""
    ids = sorted({int(user_id) for user_id in user_ids if user_id})
    if not ids or not apns_configured():
        return
    app = current_app._get_current_object()

    def _work():
        with app.app_context():
            from extensions import db
            from models import DeviceToken

            tokens = [row.token for row in DeviceToken.query.filter(DeviceToken.user_id.in_(ids)).all()]
            if not tokens:
                return
            try:
                invalid = send_to_tokens(tokens, build_payload(title, body, data))
            except Exception:  # never let push failures break the request flow
                current_app.logger.exception("APNs push failed")
                return
            if invalid:
                DeviceToken.query.filter(DeviceToken.token.in_(invalid)).delete(synchronize_session=False)
                db.session.commit()

    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="apns")
    _pool.submit(_work)
