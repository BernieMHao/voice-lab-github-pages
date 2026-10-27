#!/usr/bin/env python3
"""Export OmniVoice models to ONNX for GPU-accelerated in-browser inference.

Usage:
    python -m omnivoice.scripts.export_onnx \\
        --model_path k2-fsa/OmniVoice \\
        --output_dir ./onnx_models

Requirements:
    pip install torch transformers onnx onnxruntime optimum
"""
import argparse
import os
import torch
import torch.nn as nn


class LMWrapper(nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids_i32, audio_mask_f32, attention_mask_f32):
        return self.model(
            input_ids=input_ids_i32.long(),
            audio_mask=audio_mask_f32.bool(),
            attention_mask=attention_mask_f32.bool(),
        ).logits


class AudioEncoderWrapper(nn.Module):
    def __init__(self, tokenizer):
        super().__init__()
        self.tokenizer = tokenizer

    def forward(self, waveform):
        return self.tokenizer.encode(waveform).audio_codes.int()


class AudioDecoderWrapper(nn.Module):
    def __init__(self, tokenizer):
        super().__init__()
        self.tokenizer = tokenizer

    def forward(self, audio_codes_i32):
        return self.tokenizer.decode(audio_codes_i32.long()).audio_values


def _export(module, args, path, input_names, output_names, dynamic_axes):
    import onnx
    torch.onnx.export(
        module, args, path,
        input_names=input_names,
        output_names=output_names,
        dynamic_axes=dynamic_axes,
        opset_version=17,
        do_constant_folding=True,
    )
    data_file = os.path.basename(path) + ".data"
    model_proto = onnx.load(path, load_external_data=True)
    onnx.save_model(
        model_proto, path,
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=data_file,
        convert_attribute=False,
    )
    print(f"Exported: {path} + {data_file}")


def export_lm(model, output_dir, device):
    B, C, S = 2, model.config.num_audio_codebook, 64
    dummy_ids = torch.randint(0, 1024, (B, C, S), dtype=torch.int32, device=device)
    dummy_amask = torch.zeros(B, S, dtype=torch.float32, device=device)
    dummy_attn = torch.ones(B, 1, S, S, dtype=torch.float32, device=device)
    wrapper = LMWrapper(model).eval().to(device)
    _export(
        wrapper,
        (dummy_ids, dummy_amask, dummy_attn),
        os.path.join(output_dir, "omnivoice_lm.onnx"),
        ["input_ids", "audio_mask", "attention_mask"],
        ["logits"],
        {
            "input_ids": {0: "batch", 2: "seq"},
            "audio_mask": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 2: "seq", 3: "seq"},
            "logits": {0: "batch", 2: "seq"},
        },
    )


def export_audio_encoder(audio_tokenizer, output_dir, device):
    hop = audio_tokenizer.config.hop_length
    dummy = torch.randn(1, 1, hop * 10, dtype=torch.float32, device=device)
    wrapper = AudioEncoderWrapper(audio_tokenizer).eval().to(device)
    _export(
        wrapper, (dummy,),
        os.path.join(output_dir, "audio_encoder.onnx"),
        ["waveform"], ["audio_codes"],
        {"waveform": {0: "batch", 2: "samples"}, "audio_codes": {0: "batch", 2: "frames"}},
    )


def export_audio_decoder(audio_tokenizer, output_dir, device, num_codebook=8):
    dummy = torch.randint(0, 1024, (1, num_codebook, 10), dtype=torch.int32, device=device)
    wrapper = AudioDecoderWrapper(audio_tokenizer).eval().to(device)
    _export(
        wrapper, (dummy,),
        os.path.join(output_dir, "audio_decoder.onnx"),
        ["audio_codes"], ["audio_values"],
        {"audio_codes": {0: "batch", 2: "frames"}, "audio_values": {0: "batch", 2: "samples"}},
    )


def write_manifest(output_dir):
    import json
    data_file = "omnivoice_lm.onnx.data"
    manifest = {"lm_external_data": [data_file] if os.path.exists(os.path.join(output_dir, data_file)) else []}
    with open(os.path.join(output_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f)
    print(f"manifest.json written: {manifest}")


def main():
    parser = argparse.ArgumentParser(description="Export OmniVoice to ONNX")
    parser.add_argument("--model_path", required=True)
    parser.add_argument("--output_dir", default="./onnx_models")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"])
    parser.add_argument("--skip_lm", action="store_true")
    parser.add_argument("--skip_audio", action="store_true")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    from omnivoice.models.omnivoice import OmniVoice

    print(f"Loading model from {args.model_path} …")
    model = OmniVoice.from_pretrained(
        args.model_path,
        torch_dtype=torch.float16,
        attn_implementation="eager",
        device_map=args.device,
    )
    model.eval()

    with torch.inference_mode():
        if not args.skip_lm:
            print("Exporting LM backbone…")
            export_lm(model, args.output_dir, args.device)

        if not args.skip_audio:
            print("Exporting audio encoder…")
            export_audio_encoder(model.audio_tokenizer, args.output_dir, args.device)
            print("Exporting audio decoder…")
            export_audio_decoder(model.audio_tokenizer, args.output_dir, args.device, model.config.num_audio_codebook)

    model.text_tokenizer.save_pretrained(args.output_dir)
    write_manifest(args.output_dir)
    print(f"\nAll models exported to {args.output_dir}/")
    print("Upload the contents of that directory to serve as your model endpoint.")


if __name__ == "__main__":
    main()
