---
license: apache-2.0
pipeline_tag: text-to-speech
tags:
  - onnx
  - omnivoice
  - multilingual
  - voice-cloning
  - voice-design
  - unity
---

# OmniVoice ONNX for KitsuMate

Provider-neutral OmniVoice model profiles curated for the KitsuMate ONNX Unity runtime.

## Selecting precision

The merged backbones use filename suffixes so standard artifact pickers show
`INT4`, `INT8`, `FP16`, and `FP32` as separate choices:

- `onnx/omnivoice_int4.onnx` with `omnivoice_int4.onnx.data`
- `onnx/omnivoice_int8.onnx` with `omnivoice_int8.onnx.data`
- `onnx/omnivoice_fp16.onnx` with `omnivoice_fp16.onnx.data`
- `onnx/omnivoice_fp32.onnx` with `omnivoice_fp32.onnx_data`

Use any backbone with the shared FP32 codec files in `onnx/`. The graph and its external-data
companion must stay together.

## Profiles

- `cpu-merged-int4`: compact bidirectional merged backbone using symmetric 4-bit weight-only
  quantization with 128-weight blocks and the standard FP32 Higgs codec.
- `portable-merged-fp16`: FP16 matrix-weight storage with explicit casts to FP32 computation and unchanged input/output types. This reduces download size; it is not full FP16 execution and runtime optimizers may expand weights in memory.
- `cpu-merged-int8`: symmetric 8-bit weight-only `MatMulNBits` with 128-weight blocks, FP32 activations, and 197 quantized matrix multiplications. Embeddings and other unquantized weights remain FP32.
- `portable-merged-fp32`: unquantized merged graph using standard ONNX opset 17 operators. It is intended for any ONNX Runtime execution provider that can successfully create all sessions; it is not tied to CUDA.
- `codec-fp32`: shared Higgs Audio V2 codec for all backbone profiles.

The upstream FP16 semantic codec is intentionally not mirrored: stock ONNX Runtime 1.24.4 rejects
its mixed FP32/FP16 `LayerNormalization` contract during session creation. Keeping only the working
FP32 codec avoids presenting an artifact as portable when it is not.

The upstream split INT4 and CPU-FP16 language graphs are causal and failed speech-recognition
review. The compact profile is instead quantized directly from the working merged FP32 graph with
ONNX Runtime 1.24.4 `MatMulNBits`, preserving bidirectional attention. Whisper checks recovered the
requested words for auto voice, instructed/tagged voice design, and voice cloning.

The runtime implements 32-step iterative masked decoding, classifier-free guidance, auto voice, voice cloning, voice design, language conditioning, and OmniVoice inline controls. See `omnivoice-manifest.json` for exact roles, revisions, and hashes.

## FP16 and INT8 validation

Both variants derive from the validated bidirectional merged FP32 backbone, not the rejected causal split exports. Backbone graph plus weights are approximately 1.227 GB for FP16 and 1.119 GB for INT8, compared with 2.452 GB for FP32. Shared codecs are additional.

ONNX Runtime 1.24.4 CPU completed 32-step synthesis of two English sentences with finite logits and audio. Whisper small.en recovered the requested words for both variants. This is a small English smoke test, not a multilingual quality evaluation. Initial-logit mean absolute error versus FP32 was about 0.0034 for FP16 and 0.069 for INT8.

Both backbones also passed a Unity ONNX Runtime WebGPU session/inference smoke test (batch 2, sequence length 16, finite FP32 output). This does not establish full GPU node placement or end-to-end WebGPU speech quality. INT8 was slower than FP32 in the CPU synthesis checks; reduced size does not guarantee faster generation. FP16 storage does not guarantee lower runtime memory use.

## Attribution

The codecs are derived from [onnx-community/OmniVoice-Onnx](https://huggingface.co/onnx-community/OmniVoice-Onnx). The merged FP32 graph and its KitsuMate FP16, INT8, and INT4 derivatives are based on [gluschenko/omnivoice-onnx](https://huggingface.co/gluschenko/omnivoice-onnx). OmniVoice was created by the k2-fsa contributors; see [k2-fsa/OmniVoice](https://github.com/k2-fsa/OmniVoice) and `ATTRIBUTION.md`.

No provider compatibility is claimed merely from the profile name. A provider is supported only when it successfully creates every required session and completes inference.
