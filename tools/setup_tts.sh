#!/usr/bin/env bash
# One-time setup for the evening lesson builder: neural voice (Kokoro) and a speech
# recogniser (Parakeet) that double-checks every clip. Models come from GitHub releases.
set -e
DIR="${TTS_DIR:-$HOME/.cache/english-tts}"; mkdir -p "$DIR"; cd "$DIR"
python3 -m pip install -q kokoro-onnx soundfile sherpa-onnx
[ -f kokoro-v1.0.onnx ] || curl -sSL -o kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
[ -f voices-v1.0.bin ] || curl -sSL -o voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
if [ ! -d sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8 ]; then
  curl -sSL -o parakeet.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2
  tar xjf parakeet.tar.bz2 && rm parakeet.tar.bz2
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing"; exit 1; }
echo "TTS ready in $DIR"
