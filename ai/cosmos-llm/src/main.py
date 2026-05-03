"""Cosmos LLM service — fine-tuned Mistral 7B for compliance domain."""
from __future__ import annotations

import logging
import os
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Cosmos LLM Service", version="1.0.0")

BASE_MODEL = os.getenv("BASE_MODEL_PATH", "mistralai/Mistral-7B-Instruct-v0.2")
ADAPTER_PATH = os.getenv("ADAPTER_PATH", "/models/cosmos-compliance-adapter")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

tokenizer = None
model = None


@app.on_event("startup")
async def load_model() -> None:
    """Lazy-load the model. Falls back to base if no LoRA adapter available."""
    global tokenizer, model
    logger.info("Loading Cosmos LLM on %s", DEVICE)

    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore
    except ImportError:
        logger.warning("transformers not installed — service will run in degraded /health-only mode")
        return

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    base_model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
        device_map="auto" if DEVICE == "cuda" else None,
    )

    if os.path.exists(ADAPTER_PATH):
        try:
            from peft import PeftModel  # type: ignore
            model = PeftModel.from_pretrained(base_model, ADAPTER_PATH)
            logger.info("Loaded compliance LoRA adapter from %s", ADAPTER_PATH)
        except Exception as e:
            logger.exception("Failed to load adapter, falling back to base model: %s", e)
            model = base_model
    else:
        model = base_model
        logger.warning("No adapter at %s — using base model", ADAPTER_PATH)

    model.eval()


class ComplianceQueryRequest(BaseModel):
    query: str
    context: Optional[str] = None
    tenant_id: str
    query_type: str


class ComplianceQueryResponse(BaseModel):
    answer: str
    confidence: float
    sources: list[str]
    requires_human_review: bool


@app.post("/query", response_model=ComplianceQueryResponse)
async def query_compliance(request: ComplianceQueryRequest) -> ComplianceQueryResponse:
    if not model or not tokenizer:
        raise HTTPException(status_code=503, detail="Model not loaded")

    system_prompt = (
        "You are Cosmos, an expert AI assistant specializing in wholesale "
        "distribution compliance. You have deep knowledge of MSA reporting, "
        "tobacco excise taxes, FDA regulations, batch tracking, and wholesale "
        "distribution best practices. Always provide accurate, actionable guidance. "
        "If uncertain, say so and recommend human review."
    )

    context_section = f"\nContext: {request.context}" if request.context else ""
    prompt = f"[INST] {system_prompt}{context_section}\n\nQuestion: {request.query} [/INST]"

    inputs = tokenizer(prompt, return_tensors="pt").to(DEVICE)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=512,
            temperature=0.3,
            top_p=0.9,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )

    response = tokenizer.decode(
        outputs[0][inputs.input_ids.shape[1]:], skip_special_tokens=True,
    )

    uncertainty_phrases = ["i'm not certain", "consult", "verify with", "not sure", "may vary"]
    requires_review = any(p in response.lower() for p in uncertainty_phrases)

    return ComplianceQueryResponse(
        answer=response.strip(),
        confidence=0.85 if not requires_review else 0.55,
        sources=["cosmos-compliance-kb", "msa-regulations", "fda-guidelines"],
        requires_human_review=requires_review,
    )


@app.get("/health")
async def health() -> dict:
    return {
        "status": "healthy",
        "service": "cosmos-llm",
        "model_loaded": model is not None,
        "device": DEVICE,
    }
