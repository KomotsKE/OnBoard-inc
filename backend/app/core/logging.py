"""JSON-логи и идентификатор запроса (§9.3 docs/vision.md).

Формат — одна строка JSON на запись, в stdout: контейнер не пишет файлов.
`request_id` живёт в contextvar, поэтому любая запись внутри запроса получает
его без передачи через аргументы.
"""

import json
import logging
import sys
from contextvars import ContextVar

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)

# Поля LogRecord, которые не являются нашими дополнительными.
_STANDARD_FIELDS = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


def set_request_id(value: str) -> None:
    _request_id.set(value)


def get_request_id() -> str | None:
    return _request_id.get()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "event": record.getMessage(),
        }

        request_id = _request_id.get()
        if request_id:
            payload["request_id"] = request_id

        # Всё, что передали через extra=..., попадает в запись как есть.
        for key, value in record.__dict__.items():
            if key not in _STANDARD_FIELDS:
                payload[key] = value

        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # uvicorn пишет свой формат и дублировал бы наши записи о запросах.
    for name in ("uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = name != "uvicorn.access"


def log_event(event: str, *, level: int = logging.INFO, **fields: object) -> None:
    """Журнал значимых операций: имя события точечное, поля — в extra.

    Вызывается после успешного коммита, иначе лог сообщит о том, что откатилось.
    """
    logging.getLogger("onboard").log(level, event, extra=fields)
