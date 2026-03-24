# =============================================================================
# Stage 1 – dependency builder
# =============================================================================
FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .

RUN pip install --upgrade pip setuptools wheel \
 && pip install --prefix=/install --no-cache-dir -r requirements.txt


# =============================================================================
# Stage 2 – runtime image
# =============================================================================
FROM python:3.12-slim AS runtime

LABEL maintainer="geo-attendance-team" \
      description="Geo-Location Attendance API" \
      version="1.0.0"

# Runtime native deps: libpq5 for psycopg2, curl for healthcheck, tini as PID 1
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 appgroup \
 && useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

COPY --from=builder /install /usr/local

# Ensure packaging is available (required by kombu/celery redis transport)
RUN pip install --no-cache-dir packaging>=24.0

WORKDIR /app
COPY --chown=appuser:appgroup . .

RUN mkdir -p /app/logs /app/tmp \
 && chown -R appuser:appgroup /app/logs /app/tmp

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:8000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# Default CMD (overridden by docker-compose for dev)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
