from datetime import datetime, timedelta, timezone

_TIMEOUT_SECONDS = 90

_AVATAR_COLORS = ["#FF6B35", "#2A6FDB", "#1F8A5B", "#9A4DC9", "#C97D0E", "#D03A3A", "#2C6571"]

# user_id → {id, name, initials, color, tenant_id, last_seen}
_store: dict[int, dict] = {}


def heartbeat(user_id: int, full_name: str, tenant_id: int | None = None) -> None:
    words = full_name.split()
    initials = "".join(w[0].upper() for w in words[:2]) if words else "?"
    color = _AVATAR_COLORS[user_id % len(_AVATAR_COLORS)]
    _store[user_id] = {
        "id": user_id,
        "name": full_name,
        "initials": initials,
        "color": color,
        "tenant_id": tenant_id,
        "last_seen": datetime.now(timezone.utc),
    }


def get_online(tenant_id: int | None = None) -> list[dict]:
    threshold = datetime.now(timezone.utc) - timedelta(seconds=_TIMEOUT_SECONDS)
    return [
        {k: v for k, v in entry.items() if k not in ("last_seen", "tenant_id")}
        for entry in _store.values()
        if entry["last_seen"] > threshold
        and (tenant_id is None or entry.get("tenant_id") == tenant_id)
    ]
