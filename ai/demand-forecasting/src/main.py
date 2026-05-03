"""Cosmos demand-forecasting service."""
from __future__ import annotations

import logging
import math

import pandas as pd
from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from .forecaster import HybridForecaster
from .model_store import ModelStore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cosmos Demand Forecasting", version="1.0.0")
model_store = ModelStore()


class ForecastRequest(BaseModel):
    tenant_id: str
    sku_id: str
    warehouse_id: str
    horizon_days: int = 30


class TrainRequest(BaseModel):
    tenant_id: str
    sku_id: str
    warehouse_id: str
    history: list[dict]


class ReorderRecommendation(BaseModel):
    sku_id: str
    warehouse_id: str
    current_stock: int
    forecasted_demand: float
    days_of_cover: float
    reorder_point: int
    suggested_order_qty: int
    confidence: float
    stockout_risk: str


def _key(req: ForecastRequest) -> str:
    return f"{req.tenant_id}:{req.sku_id}:{req.warehouse_id}"


@app.post("/forecast")
async def get_forecast(request: ForecastRequest):
    forecaster = model_store.get(_key(request))
    if not forecaster:
        raise HTTPException(status_code=404, detail="No trained model for this SKU/warehouse")
    return forecaster.predict(request.horizon_days)


@app.post("/train")
async def train_model(request: TrainRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(_train_async, request)
    return {"status": "training_queued", "sku_id": request.sku_id}


@app.post("/reorder-recommendation")
async def get_reorder_recommendation(
    request: ForecastRequest,
    current_stock: int,
    lead_time_days: int = 7,
) -> ReorderRecommendation:
    forecaster = model_store.get(_key(request))
    if not forecaster:
        raise HTTPException(status_code=404, detail="No trained model")

    forecast = forecaster.predict(request.horizon_days)
    avg_daily = (
        forecast["total_forecasted"] / request.horizon_days if request.horizon_days > 0 else 0.0
    )
    days_of_cover = current_stock / avg_daily if avg_daily > 0 else 999

    forecast_lead = [f["forecast"] for f in forecast["forecast"][:lead_time_days]]
    std_dev = float(pd.Series(forecast_lead).std()) if len(forecast_lead) > 1 else 0.0
    safety_stock = int(1.65 * std_dev * math.sqrt(lead_time_days))
    reorder_point = int(avg_daily * lead_time_days + safety_stock)
    demand_lead = int(avg_daily * lead_time_days)
    eoq = int(math.sqrt(2 * demand_lead * 50 / 0.20)) if avg_daily > 0 else 0

    if days_of_cover < lead_time_days:
        risk = "CRITICAL"
    elif days_of_cover < lead_time_days * 1.5:
        risk = "HIGH"
    elif days_of_cover < lead_time_days * 2:
        risk = "MEDIUM"
    else:
        risk = "LOW"

    return ReorderRecommendation(
        sku_id=request.sku_id,
        warehouse_id=request.warehouse_id,
        current_stock=current_stock,
        forecasted_demand=forecast["total_forecasted"],
        days_of_cover=round(days_of_cover, 1),
        reorder_point=reorder_point,
        suggested_order_qty=max(eoq, demand_lead + safety_stock - current_stock),
        confidence=0.85,
        stockout_risk=risk,
    )


async def _train_async(request: TrainRequest) -> None:
    try:
        df = pd.DataFrame(request.history)
        df["ds"] = pd.to_datetime(df["date"])
        df["y"] = df["quantity_sold"]
        forecaster = HybridForecaster()
        forecaster.train(df)
        model_store.save(f"{request.tenant_id}:{request.sku_id}:{request.warehouse_id}", forecaster)
        logger.info("model trained for %s", request.sku_id)
    except Exception as e:
        logger.exception("training failed: %s", e)


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "demand-forecasting",
        "models_loaded": model_store.count(),
    }
