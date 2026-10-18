# Образ разработки: включает dev-зависимости, чтобы в нём же гонять тесты.
# Разделение на prod-образ без них — при подготовке к деплою (§15 docs/vision.md).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir -e ".[dev]"

# Непривилегированный пользователь: процесс в контейнере не должен быть root.
RUN useradd --create-home --uid 1000 onboard && chown -R onboard:onboard /app
USER onboard

EXPOSE 8000

# Один воркер: rate limiter держит счётчики в памяти процесса, при нескольких
# воркерах лимиты считались бы неверно (§4.5 docs/vision.md).
# Таймауты keep-alive и graceful shutdown — §9.1 docs/vision.md.
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "1", \
     "--timeout-keep-alive", "5", \
     "--timeout-graceful-shutdown", "20"]
