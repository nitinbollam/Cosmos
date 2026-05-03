"""Cosmos OCR engine — invoice extraction (PaddleOCR)."""
from __future__ import annotations

import io
import logging
import re

import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cosmos OCR Engine", version="1.0.0")
ocr = None


@app.on_event("startup")
async def init_ocr() -> None:
    global ocr
    try:
        from paddleocr import PaddleOCR  # type: ignore
        ocr = PaddleOCR(use_angle_cls=True, lang="en", use_gpu=False, show_log=False)
        logger.info("PaddleOCR initialized")
    except ImportError:
        logger.warning("paddleocr not installed — OCR endpoints will return 503")


class InvoiceData(BaseModel):
    invoice_number: str | None
    vendor_name: str | None
    invoice_date: str | None
    due_date: str | None
    total_amount: float | None
    tax_amount: float | None
    line_items: list[dict]
    raw_text: str
    confidence: float


@app.post("/extract/invoice", response_model=InvoiceData)
async def extract_invoice(file: UploadFile) -> InvoiceData:
    if ocr is None:
        raise HTTPException(status_code=503, detail="OCR engine not available")

    if not file.content_type or (
        not file.content_type.startswith("image/") and file.content_type != "application/pdf"
    ):
        raise HTTPException(status_code=400, detail="File must be image or PDF")

    content = await file.read()

    if file.content_type == "application/pdf":
        try:
            import fitz  # type: ignore
        except ImportError as e:
            raise HTTPException(status_code=503, detail="PDF support unavailable (install pymupdf)") from e
        doc = fitz.open(stream=content, filetype="pdf")
        clip = doc[0].get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
        img = Image.frombytes("RGB", [clip.width, clip.height], clip.samples)
    else:
        img = Image.open(io.BytesIO(content)).convert("RGB")

    result = ocr.ocr(np.array(img), cls=True)
    if not result or not result[0]:
        raise HTTPException(status_code=422, detail="No text detected")

    blocks = [(line[1][0], float(line[1][1])) for line in result[0]]
    raw_text = " ".join(t for t, _ in blocks)
    avg_confidence = sum(c for _, c in blocks) / max(1, len(blocks))

    fields = _parse_invoice_fields(raw_text, blocks)
    fields["raw_text"] = raw_text
    fields["confidence"] = round(avg_confidence, 3)
    return InvoiceData(**fields)


def _parse_invoice_fields(raw_text: str, blocks: list[tuple[str, float]]) -> dict:
    upper = raw_text.upper()
    inv_match = re.search(r"(?:INVOICE|INV)[#\s\-:]+([A-Z0-9\-]+)", upper)
    dates = re.findall(r"\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b", raw_text)
    amounts = [float(a.replace(",", "")) for a in re.findall(r"\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2}))", raw_text)]
    tax_match = re.search(r"(?:TAX|VAT|EXCISE)[:\s]+\$?\s*(\d+(?:\.\d{2})?)", upper)

    vendor_name = next(
        (
            t for t, c in blocks[:5]
            if c > 0.9 and len(t) > 3 and not any(
                kw in t.upper() for kw in ["INVOICE", "DATE", "TO:", "FROM:"]
            )
        ),
        None,
    )

    return {
        "invoice_number": inv_match.group(1) if inv_match else None,
        "vendor_name": vendor_name,
        "invoice_date": dates[0] if dates else None,
        "due_date": dates[1] if len(dates) > 1 else None,
        "total_amount": max(amounts) if amounts else None,
        "tax_amount": float(tax_match.group(1)) if tax_match else None,
        "line_items": [],
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "ocr-engine",
        "ocr_engine": "PaddleOCR" if ocr is not None else "unavailable",
    }
