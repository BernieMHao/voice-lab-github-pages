# CLAUDE.md

## Web / ONNX export

`torch.nn.attention.flex_attention` is not ONNX-exportable. Pass `attn_implementation="eager"` to `from_pretrained` before calling `torch.onnx.export`.

WebGPU backend in `onnxruntime-web` does not accept `int64` tensors. The export wrappers in `export_onnx.py` accept `int32` inputs and cast to `int64` internally via `.long()` — do not change the wrapper input dtype.

The `attention_mask` in `OmniVoice.forward` is **full** (non-causal), not lower-triangular. Cond batch uses `[:seqLen, :seqLen] = True`, uncond uses `[:numTarget, :numTarget] = True` plus diagonal for padding positions. This is a masked-diffusion model, not autoregressive.

`OfflineAudioContext` in `audio.js` requires two passes (decode then resample) because the browser's `decodeAudioData` does not guarantee resampling to the target rate in a single call.

`onnxruntime-web` is pinned to **exact version `1.21.0`** in `web/package.json`. The `wasmPaths` CDN URL in `omnivoice_engine.js` is hardcoded to the same version. Both must be updated together — a range in `package.json` (e.g. `^1.21.0`) can resolve to a different runtime version than the CDN serves, breaking WASM initialization silently.

`onnxruntime-web`'s `InferenceSession.create(url)` does not support custom request headers. To pass an `Authorization: Bearer` token for authenticated HuggingFace downloads, fetch the model to an `ArrayBuffer` first and call `InferenceSession.create(new Uint8Array(buf))`. The same applies to external data files passed via `lmOpts.externalData`.

For browser-compatible model size reduction: export as **FP16** (half precision) instead of FP32, then apply ONNX graph simplification (`onnxsim`) to fuse ops and remove redundant nodes. Do not use INT8 dynamic quantization — it introduces operations unsupported by the ORT-web WASM backend, causing silent errors (code 988458488). FP16 + graph optimization reduces size by ~60% (2.4GB → 900MB) while maintaining full precision for audio quality and WebGPU compatibility.

## Browser environment

`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers are required for `SharedArrayBuffer` (used by the ONNX WASM multi-threaded backend). Vite dev server sets these automatically; a production static server must set them manually.
