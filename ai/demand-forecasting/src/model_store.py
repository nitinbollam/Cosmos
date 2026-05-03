from __future__ import annotations

import os
import pickle
from pathlib import Path
from typing import Optional

from .forecaster import HybridForecaster


class ModelStore:
    """
    Persists trained HybridForecaster instances.
    Local filesystem by default; set MODEL_STORE_S3_BUCKET (+ optional MODEL_STORE_S3_PREFIX)
    to use S3 with AES256 server-side encryption on put.
    """

    def __init__(self, root: str | None = None) -> None:
        self._bucket = os.getenv("MODEL_STORE_S3_BUCKET", "").strip()
        self._prefix = (
            os.getenv("MODEL_STORE_S3_PREFIX", "demand-models").strip().strip("/") or "demand-models"
        )
        self._local_root = Path(root or os.getenv("MODEL_STORE_DIR", "/tmp/cosmos-models"))
        self._cache: dict[str, HybridForecaster] = {}
        self._s3 = None
        if not self._bucket:
            self._local_root.mkdir(parents=True, exist_ok=True)

    def _safe_filename(self, key: str) -> str:
        return key.replace("/", "_").replace(":", "_")

    def _object_key(self, safe: str) -> str:
        return f"{self._prefix}/{safe}.pkl"

    def _client(self):
        if self._s3 is not None:
            return self._s3
        import boto3

        self._s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1"))
        return self._s3

    def _read_bytes(self, safe: str) -> Optional[bytes]:
        if self._bucket:
            from botocore.exceptions import ClientError

            try:
                body = self._client().get_object(Bucket=self._bucket, Key=self._object_key(safe))["Body"]
                return body.read()
            except ClientError as e:
                code = e.response.get("Error", {}).get("Code", "")
                if code in ("404", "NoSuchKey", "NotFound"):
                    return None
                raise
        path = self._local_root / f"{safe}.pkl"
        if not path.exists():
            return None
        return path.read_bytes()

    def save(self, key: str, forecaster: HybridForecaster) -> None:
        blob = pickle.dumps(forecaster, protocol=pickle.HIGHEST_PROTOCOL)
        safe = self._safe_filename(key)
        if self._bucket:
            self._client().put_object(
                Bucket=self._bucket,
                Key=self._object_key(safe),
                Body=blob,
                ServerSideEncryption="AES256",
            )
        else:
            path = self._local_root / f"{safe}.pkl"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(blob)
        self._cache[key] = forecaster

    def get(self, key: str) -> Optional[HybridForecaster]:
        if key in self._cache:
            return self._cache[key]
        safe = self._safe_filename(key)
        raw = self._read_bytes(safe)
        if raw is None:
            return None
        forecaster = pickle.loads(raw)
        self._cache[key] = forecaster
        return forecaster

    def count(self) -> int:
        if not self._bucket:
            return sum(1 for _ in self._local_root.glob("*.pkl"))
        n = 0
        paginator = self._client().get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._bucket, Prefix=f"{self._prefix}/"):
            for obj in page.get("Contents", []) or []:
                if str(obj.get("Key", "")).endswith(".pkl"):
                    n += 1
        return n
