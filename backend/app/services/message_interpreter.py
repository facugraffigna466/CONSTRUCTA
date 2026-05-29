"""
Rule-based interpreter for WhatsApp text messages.

Detects three action types from natural language:
  - complete   → task should be marked COMPLETADA
  - progress   → task should be updated to EN_PROGRESO with a specific percentage
  - block      → task should be marked BLOQUEADA

Returns an InterpretationResult that MessageService uses to call
TaskService.apply_status_update(). No DB access, purely functional.
"""
import re
from dataclasses import dataclass

from app.models.task import TaskStatus

# Multi-word phrases must come before single-word keywords so the longer
# match wins when both could apply to the same text.
_BLOCKED_PHRASES: list[str] = [
    "no podemos avanzar",
    "falta material",
    "demorado",
    "demora",
    "bloqueado",
]

_COMPLETION_WORDS: frozenset[str] = frozenset(
    {"terminado", "finalizado", "listo", "completado"}
)


@dataclass
class InterpretationResult:
    action: str               # "complete" | "progress" | "block" | "none"
    status: TaskStatus | None
    progress: int | None      # None means "keep current"
    reason: str | None
    matched_rule: str | None

    def to_dict(self) -> dict:
        return {
            "action": self.action,
            "status": self.status.value if self.status else None,
            "progress": self.progress,
            "reason": self.reason,
            "matched_rule": self.matched_rule,
        }


_NO_MATCH = InterpretationResult(
    action="none", status=None, progress=None, reason=None, matched_rule=None
)


def interpret(body: str | None) -> InterpretationResult:
    if not body or not body.strip():
        return _NO_MATCH

    text = body.lower().strip()

    # 1. Completion keywords (word-boundary match avoids partial hits)
    words = set(re.findall(r"\b\w+\b", text))
    for word in _COMPLETION_WORDS:
        if word in words:
            return InterpretationResult(
                action="complete",
                status=TaskStatus.COMPLETADA,
                progress=100,
                reason=f"Keyword: '{word}'",
                matched_rule="completion_keyword",
            )

    # 2. Block / delay phrases (multi-word entries checked first by list order)
    for phrase in _BLOCKED_PHRASES:
        if phrase in text:
            return InterpretationResult(
                action="block",
                status=TaskStatus.BLOQUEADA,
                progress=None,
                reason=f"Block indicator: '{phrase}'",
                matched_rule="block_keyword",
            )

    return _NO_MATCH
