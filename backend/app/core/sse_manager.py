import asyncio
from collections import defaultdict


class SSEManager:
    def __init__(self) -> None:
        self._queues: dict[int, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, obra_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._queues[obra_id].add(q)
        return q

    def unsubscribe(self, obra_id: int, q: asyncio.Queue) -> None:
        self._queues[obra_id].discard(q)

    async def emit(self, obra_id: int, event: str = "task_updated") -> None:
        for q in list(self._queues.get(obra_id, [])):
            await q.put(event)


sse_manager = SSEManager()
