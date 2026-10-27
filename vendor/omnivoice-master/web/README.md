# OmniVoice Web — GPU-Accelerated In-Browser TTS

Runs OmniVoice entirely in the browser using **WebGPU** (falls back to WASM).

## Quick Start

### 1. Export ONNX models (requires Python + GPU environment)

```bash
pip install torch transformers optimum omnivoice

python -m omnivoice.scripts.export_onnx \
    --model_path k2-fsa/OmniVoice \
    --output_dir ./web/public/models
```

This produces:
- `omnivoice_lm.onnx` — LM backbone (Qwen3-0.6B + audio heads)
- `audio_encoder.onnx` — HiggsAudio encoder (audio → tokens)
- `audio_decoder.onnx` — HiggsAudio decoder (tokens → audio)
- Tokenizer files (`tokenizer.json`, `tokenizer_config.json`, etc.)

### 2. Serve the web app

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge (WebGPU required for GPU acceleration).

### 3. Production build

```bash
npm run build
# Serve dist/ with any static file server
```

**Required HTTP headers** for multi-threaded WASM (add to server config):
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Architecture

```
User Text → Tokenizer (transformers.js)
         → Duration Estimator (duration.js)
         → Build sequence [style | text | ref_audio | [MASK...]]
         → N-step iterative masked token prediction (omnivoice_engine.js)
              ↓ each step: LM forward pass (omnivoice_lm.onnx via WebGPU)
              ↓ CFG scoring + top-k unmask
         → Audio decoder (audio_decoder.onnx)
         → WAV output
```

## Model Loading & Authentication

The web app can load models from any publicly accessible URL or from HuggingFace Hub. To remove download rate limiting (0.3 MB/s → 2-3 MB/s), provide a HuggingFace token in the UI:

1. Generate a HuggingFace token at [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. In the web app, paste the token in "HuggingFace token (optional)" field
3. Set model URL to a HuggingFace repo: `https://huggingface.co/lanmower/OmniVoice-ONNX/resolve/main`

The app handles all HTTP authentication headers internally — tokens remain in-browser only.

## Browser Requirements

| Feature | Minimum |
|---|---|
| WebGPU | Chrome 113+, Edge 113+ |
| WASM fallback | Any modern browser |
| SharedArrayBuffer | Requires COOP/COEP headers |

## Model Size

| File | Size (fp32) | Size (fp16) |
|---|---|---|
| omnivoice_lm.onnx | ~2.4 GB | ~1.2 GB |
| audio_encoder.onnx | ~200 MB | ~100 MB |
| audio_decoder.onnx | ~200 MB | ~100 MB |

For browser deployment, export to **FP16** (default in export script) for ~50% size reduction. The export also applies ONNX graph simplification to further optimize performance.

```bash
python -m omnivoice.scripts.export_onnx --model_path k2-fsa/OmniVoice \
    --output_dir ./web/public/models
```
