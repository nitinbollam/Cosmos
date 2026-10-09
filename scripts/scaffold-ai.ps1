param(
  [Parameter(Mandatory=$true)] [string]$Name,
  [Parameter(Mandatory=$true)] [int]$Port,
  [Parameter(Mandatory=$true)] [string]$Description
)

$root = Join-Path (Resolve-Path "$PSScriptRoot\..").Path "ai\$Name"
New-Item -ItemType Directory -Force -Path "$root\src" | Out-Null

@"
"""$Name FastAPI service. SCAFFOLD ONLY."""
from __future__ import annotations

from fastapi import FastAPI

app = FastAPI(title="$Name", version="1.0.0")


@app.get("/health")
async def health() -> dict:
    return {"status": "healthy", "service": "$Name"}
"@ | Set-Content -Path "$root\src\main.py" -Encoding utf8

"" | Set-Content -Path "$root\src\__init__.py" -Encoding utf8

@'
fastapi==0.111.1
uvicorn[standard]==0.30.3
pydantic==2.8.2
'@ | Set-Content -Path "$root\requirements.txt" -Encoding utf8

@"
FROM python:3.11-slim AS builder
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN addgroup --system pleros && adduser --system --ingroup pleros pleros
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY src/ ./src/
USER pleros
EXPOSE $Port
HEALTHCHECK --interval=30s --timeout=10s CMD curl -f http://localhost:$Port/health || exit 1
CMD [`"uvicorn`", `"src.main:app`", `"--host`", `"0.0.0.0`", `"--port`", `"$Port`"]
"@ | Set-Content -Path "$root\Dockerfile" -Encoding utf8

@"
# $Name

**Status: SCAFFOLD ONLY.** $Description

Default port: **$Port**.

Open a follow-up session to implement the model + endpoints.
"@ | Set-Content -Path "$root\README.md" -Encoding utf8

Write-Host "scaffolded ai\$Name on :$Port"
