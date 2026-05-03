"""LSTM + Prophet hybrid forecaster."""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np
import pandas as pd
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)


class LSTMForecaster(nn.Module):
    def __init__(
        self,
        input_size: int = 10,
        hidden_size: int = 64,
        num_layers: int = 2,
        output_size: int = 7,
    ):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.lstm = nn.LSTM(
            input_size, hidden_size, num_layers, batch_first=True, dropout=0.2,
        )
        self.fc = nn.Linear(hidden_size, output_size)
        self.relu = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size)
        c0 = torch.zeros(self.num_layers, x.size(0), self.hidden_size)
        out, _ = self.lstm(x, (h0, c0))
        return self.fc(self.relu(out[:, -1, :]))


class HybridForecaster:
    """Prophet for seasonality, LSTM for recent patterns. 60/40 ensemble."""

    def __init__(self) -> None:
        self.lstm_model = LSTMForecaster()
        # Prophet is imported lazily so this module can load even if Prophet is missing.
        self.prophet_model = None
        self.is_trained = False
        self._feature_count = 10

    def train(self, history_df: pd.DataFrame) -> None:
        try:
            from prophet import Prophet  # type: ignore
        except ImportError as e:
            raise RuntimeError("prophet is required to train HybridForecaster") from e

        self.prophet_model = Prophet(
            changepoint_prior_scale=0.05,
            seasonality_prior_scale=10.0,
            weekly_seasonality=True,
            yearly_seasonality=True,
        )
        prophet_df = history_df[["ds", "y"]].copy()
        self.prophet_model.fit(prophet_df)

        feature_cols = [
            "y", "price", "promotions", "day_of_week", "is_holiday",
            "weather_score", "prev_7d_avg", "prev_30d_avg", "stock_level", "competitor_oos",
        ]
        available = [f for f in feature_cols if f in history_df.columns]
        self._feature_count = len(available)
        if self._feature_count != self.lstm_model.lstm.input_size:
            self.lstm_model = LSTMForecaster(input_size=self._feature_count)

        X, y = self._create_sequences(history_df[available].values, sequence_length=30, horizon=7)
        if len(X) == 0:
            logger.warning("not enough history to train LSTM (need >37 days); using Prophet only")
            self.is_trained = True
            return

        X_t = torch.FloatTensor(X)
        y_t = torch.FloatTensor(y)
        optimizer = torch.optim.Adam(self.lstm_model.parameters(), lr=0.001)
        criterion = nn.MSELoss()

        self.lstm_model.train()
        for epoch in range(100):
            optimizer.zero_grad()
            loss = criterion(self.lstm_model(X_t), y_t)
            loss.backward()
            optimizer.step()
            if epoch % 20 == 0:
                logger.info("epoch %s loss %.4f", epoch, loss.item())

        self.is_trained = True

    def predict(
        self,
        horizon_days: int = 30,
        features_df: Optional[pd.DataFrame] = None,
    ) -> dict:
        if not self.is_trained or self.prophet_model is None:
            raise RuntimeError("Model must be trained before prediction")

        future = self.prophet_model.make_future_dataframe(periods=horizon_days)
        prophet_forecast = self.prophet_model.predict(future)
        prophet_values = prophet_forecast.tail(horizon_days)[
            ["ds", "yhat", "yhat_lower", "yhat_upper"]
        ]

        lstm_values = None
        if features_df is not None and len(features_df) >= 30:
            self.lstm_model.eval()
            with torch.no_grad():
                X = torch.FloatTensor(features_df.values[-30:]).unsqueeze(0)
                lstm_values = self.lstm_model(X).numpy()[0]

        final_forecast = []
        for i, (_, row) in enumerate(prophet_values.iterrows()):
            prophet_val = max(0.0, float(row["yhat"]))
            if lstm_values is not None:
                lstm_val = max(0.0, float(lstm_values[min(i, len(lstm_values) - 1)]))
                val = 0.6 * prophet_val + 0.4 * lstm_val
            else:
                val = prophet_val
            final_forecast.append({
                "date": row["ds"].strftime("%Y-%m-%d"),
                "forecast": round(val, 2),
                "lower_bound": max(0.0, round(float(row["yhat_lower"]), 2)),
                "upper_bound": round(float(row["yhat_upper"]), 2),
                "confidence": 0.85,
            })

        return {
            "horizon_days": horizon_days,
            "forecast": final_forecast,
            "model": "hybrid_lstm_prophet",
            "total_forecasted": sum(f["forecast"] for f in final_forecast),
        }

    @staticmethod
    def _create_sequences(data: np.ndarray, sequence_length: int, horizon: int):
        X, y = [], []
        for i in range(sequence_length, len(data) - horizon):
            X.append(data[i - sequence_length:i])
            y.append(data[i:i + horizon, 0])
        return np.array(X), np.array(y)
