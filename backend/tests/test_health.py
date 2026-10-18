from app.main import REQUEST_ID_HEADER, _resolve_request_id


async def test_health_reports_ok_with_database(client):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


async def test_health_returns_request_id_header(client):
    response = await client.get("/health")

    assert response.headers["x-request-id"]


async def test_incoming_request_id_is_reused(client):
    response = await client.get("/health", headers={"X-Request-Id": "upstream-req-42"})

    assert response.headers["x-request-id"] == "upstream-req-42"


def test_unsafe_incoming_request_id_is_replaced():
    """Чужое значение уходит в заголовок ответа, поэтому принимается только
    безопасный набор символов: перевод строки, пробел, пустое значение,
    не-ASCII и слишком длинное — заменяются своим идентификатором.

    Проверяется напрямую, а не через клиент: httpx и сам отвергает часть
    таких значений, и тогда проверялась бы его валидация, а не наша.
    """
    unsafe = [
        b"\r\nX-Injected: 1",
        b"has space",
        b"",
        b"\xff\xfe",
        b"x" * 65,
        b"semi;colon",
    ]
    for value in unsafe:
        resolved = _resolve_request_id({"headers": [(REQUEST_ID_HEADER, value)]})

        assert len(resolved) == 32, value
        assert resolved != value.decode("latin-1", errors="replace")


def test_safe_incoming_request_id_is_kept():
    for value in (b"upstream-req-42", b"abc.DEF_123-x", b"x" * 64):
        resolved = _resolve_request_id({"headers": [(REQUEST_ID_HEADER, value)]})

        assert resolved == value.decode()


def test_request_id_generated_when_header_absent():
    resolved = _resolve_request_id({"headers": []})

    assert len(resolved) == 32
