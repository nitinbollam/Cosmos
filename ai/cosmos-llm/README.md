# cosmos-llm

Fine-tuned Mistral 7B for wholesale-distribution compliance Q&A.

Default port: **8001**.

If `ADAPTER_PATH` doesn't point to a valid LoRA adapter, the service falls back to the base Mistral model. Adapter training pipeline is **not** included in this session — see `MISSING.md`.
