"""Cashflow projection service — simple seasonal smoothing + weekly cash forecast from inflow/outflow series."""
from __future__ import annotations

import logging
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="cashflow-model", version="1.0.0")


class CashflowPoint(BaseModel):
    period: str = Field(..., description="ISO week or month label (opaque to model)")
    inflow: float = Field(..., ge=0)
    outflow: float = Field(..., ge=0)


class ForecastRequest(BaseModel):
    tenant_id: str
    history: list[CashflowPoint] = Field(..., min_length=3)
    horizon_weeks: int = Field(8, ge=1, le=52)
    seasonal_period: int | None = Field(
        None,
        description="If set (e.g. 4 for monthly inside weekly data), apply simple seasonal adjustment",
    )


class ForecastBucket(BaseModel):
    label: str
    projected_net: float
    projected_inflow: float
    projected_outflow: float


class ForecastResponse(BaseModel):
    tenant_id: str
    method: str
    weekly_net_baseline: float
    forecast: list[ForecastBucket]
    warnings: list[str]


def _ewma(values: np.ndarray, alpha: float) -> float:
    if values.size == 0:
        return 0.0
    w = values[0]
    for x in values[1:]:
        w = alpha * x + (1 - alpha) * w
    return float(w)


def _seasonal_deseasonalize(net: np.ndarray, period: int) -> np.ndarray:
    if period < 2 or net.size < period * 2:
        return net
    out = net.copy().astype(float)
    for i in range(net.size):
        idx = [j for j in range(i % period, net.size, period)]
        season_mean = float(np.mean(net[idx])) if idx else 0.0
        overall = float(np.mean(net)) or 1.0
        out[i] = net[i] * (overall / max(season_mean, 1e-6))
    return out


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "healthy", "service": "cashflow-model"}


@app.post("/forecast/cash-flow", response_model=ForecastResponse)
async def forecast_cash_flow(body: ForecastRequest) -> ForecastResponse:
    warns: list[str] = []
    net = np.array([p.inflow - p.outflow for p in body.history], dtype=float)
    labels = [p.period for p in body.history]

    if np.any(~np.isfinite(net)):
        raise HTTPException(status_code=400, detail="Non-finite values in history")

    series = net
    method_bits: list[str] = ["net_ewma"]
    if body.seasonal_period and body.seasonal_period >= 2:
        series = _seasonal_deseasonalize(net, body.seasonal_period)
        method_bits.append(f"seasonal_{body.seasonal_period}")

    alpha = max(0.05, min(0.55, 2.0 / (1.0 + series.size)))
    baseline = _ewma(series, alpha)

    avg_in = float(np.mean([p.inflow for p in body.history]))
    avg_out = float(np.mean([p.outflow for p in body.history]))
    if avg_in < avg_out:
        warns.append("Historical net cashflow negative on average.")

    buckets: list[ForecastBucket] = []
    last_net = float(series[-1]) if series.size else 0.0
    for h in range(1, body.horizon_weeks + 1):
        # AR(1)-style damping toward EWMA baseline
        last_net = baseline + (last_net - baseline) * 0.88
        n = float(last_net)
        if avg_in <= 1e-9:
            pf_in = 0.0
            pf_out = max(-n, 0.0)
        else:
            m = max(0.0, (n + avg_out) / avg_in)
            pf_in = m * avg_in
            pf_out = float(avg_out)
        buckets.append(
            ForecastBucket(
                label=f"W+{h}",
                projected_net=float(pf_in - pf_out),
                projected_inflow=float(pf_in),
                projected_outflow=float(pf_out),
            )
        )

    return ForecastResponse(
        tenant_id=body.tenant_id,
        method="+".join(method_bits),
        weekly_net_baseline=float(baseline),
        forecast=buckets,
        warnings=warns,
    )
