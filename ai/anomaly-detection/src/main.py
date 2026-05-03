"""Univariate anomaly detection — robust z-score and IQR spikes on KPI series."""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="anomaly-detection", version="1.0.0")


class SeriesPoint(BaseModel):
    timestamp: str
    value: float


class DetectRequest(BaseModel):
    tenant_id: str
    metric: str = Field(..., min_length=1, max_length=120)
    points: list[SeriesPoint] = Field(..., min_length=8)
    z_threshold: float = Field(3.5, ge=2.0, le=12.0)
    iqr_k: float = Field(1.5, ge=0.5, le=6.0)


class AnomalyHit(BaseModel):
    timestamp: str
    value: float
    score: float
    reason: str


class DetectResponse(BaseModel):
    tenant_id: str
    metric: str
    anomalies: list[AnomalyHit]
    stats: dict[str, float]


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "healthy", "service": "anomaly-detection"}


@app.post("/detect/series", response_model=DetectResponse)
async def detect_series(body: DetectRequest) -> DetectResponse:
    vals = np.array([p.value for p in body.points], dtype=float)
    if np.any(~np.isfinite(vals)):
        raise HTTPException(status_code=400, detail="Non-finite values in series")

    median = float(np.median(vals))
    q1 = float(np.quantile(vals, 0.25))
    q3 = float(np.quantile(vals, 0.75))
    iqr = max(q3 - q1, 1e-9)
    hi_fence = q3 + body.iqr_k * iqr
    lo_fence = q1 - body.iqr_k * iqr

    # Median absolute deviation based robust z-score (last window compared to bulk)
    dev = vals - median
    mad = float(np.median(np.abs(dev))) + 1e-9
    robust_std = 1.4826 * mad
    mean_c = float(np.mean(vals))

    anomalies: list[AnomalyHit] = []
    for p in body.points:
        v = p.value
        reasons: list[str] = []
        z = abs(v - median) / max(robust_std, 1e-9)
        if z >= body.z_threshold:
            reasons.append(f"robust_z>={body.z_threshold:.2f}")
        if v > hi_fence or v < lo_fence:
            reasons.append("tukey_iqr")
        if reasons:
            anomalies.append(
                AnomalyHit(
                    timestamp=p.timestamp,
                    value=v,
                    score=float(z),
                    reason=",".join(reasons),
                )
            )

    return DetectResponse(
        tenant_id=body.tenant_id,
        metric=body.metric,
        anomalies=anomalies,
        stats={
            "median": median,
            "mean": mean_c,
            "q1": q1,
            "q3": q3,
            "iqr": float(iqr),
            "mad": mad,
            "robust_std": robust_std,
        },
    )
