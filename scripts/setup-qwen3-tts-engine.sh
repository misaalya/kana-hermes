#!/usr/bin/env bash
# One-time setup for the pure-C Qwen3-TTS engine used by services/qwen3-tts/server.mjs.
#
# - clones github.com/gabriele-mastrapasqua/qwen3-tts at a pinned commit (MIT)
# - builds the CLI with OpenBLAS, choosing the best SIMD path for this CPU
# - prepares the 0.6B-Base model directory, reusing the local Hugging Face
#   snapshot when present so the ~2.3 GB download is skipped.
#
# Env overrides: KANA_TTS_ENGINE_DIR, KANA_TTS_MODEL_DIR
set -euo pipefail

PINNED_COMMIT="328ab9cb241774572bb59917af199bdf64a17227"
REPO_URL="https://github.com/gabriele-mastrapasqua/qwen3-tts.git"

ENGINE_DIR="${KANA_TTS_ENGINE_DIR:-$HOME/.local/share/kana/qwen3-tts-engine}"
MODEL_DIR="${KANA_TTS_MODEL_DIR:-$ENGINE_DIR/qwen3-tts-0.6b-base}"

echo "==> engine dir: $ENGINE_DIR"
if [ ! -d "$ENGINE_DIR/.git" ]; then
    git clone --quiet "$REPO_URL" "$ENGINE_DIR"
fi
git -C "$ENGINE_DIR" fetch --quiet origin
git -C "$ENGINE_DIR" checkout --quiet --detach "$PINNED_COMMIT"

echo "==> checking build dependencies"
MISSING=()
command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || MISSING+=("build-essential")
if ! ldconfig -p 2>/dev/null | grep -q libopenblas; then
    MISSING+=("libopenblas-dev")
fi
if [ "${#MISSING[@]}" -gt 0 ]; then
    echo "installing system packages: ${MISSING[*]}"
    SUDO=""
    if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi
    $SUDO apt-get update -qq
    $SUDO apt-get install -y -qq "${MISSING[@]}"
fi

echo "==> applying Kana engine patches (if any)"
PATCH_DIR="$(cd "$(dirname "$0")/.." && pwd)/services/qwen3-tts/engine-patches"
if [ -d "$PATCH_DIR" ] && ls "$PATCH_DIR"/*.patch >/dev/null 2>&1; then
    for patch in "$PATCH_DIR"/*.patch; do
        if git -C "$ENGINE_DIR" apply --check "$patch" 2>/dev/null; then
            git -C "$ENGINE_DIR" apply "$patch"
            echo "  applied $(basename "$patch")"
        else
            echo "  skipped $(basename "$patch") (already applied or inapplicable)"
        fi
    done
fi

echo "==> detecting SIMD path"
# Prefer the avx512bf16 target when silicon exposes AVX512-BF16: it enables
# the native VDPBF16PS bf16 matvec (~20% faster than widen+FMA on Zen4/5).
SIMD="avx2"
if grep -q avx512_bf16 /proc/cpuinfo; then
    SIMD="avx512bf16"
elif grep -q avx512_vnni /proc/cpuinfo; then
    SIMD="avx512vnni"
elif ! grep -q avx2 /proc/cpuinfo; then
    SIMD="scalar"
fi
echo "building with SIMD=$SIMD"
make -C "$ENGINE_DIR" blas "SIMD=$SIMD"

echo "==> preparing Base model directory: $MODEL_DIR"
mkdir -p "$MODEL_DIR/speech_tokenizer"
FILES=(
    config.json generation_config.json tokenizer_config.json
    preprocessor_config.json model.safetensors vocab.json merges.txt
)
SPEECH_FILES=(config.json configuration.json model.safetensors preprocessor_config.json)

copy_from_hf_cache() {
    local snapshot
    snapshot="$(find "$HOME/.cache/huggingface/hub/models--Qwen--Qwen3-TTS-12Hz-0.6B-Base/snapshots" \
        -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1 || true)"
    if [ -z "$snapshot" ] || [ ! -f "$snapshot/model.safetensors" ]; then
        return 1
    fi
    echo "reusing existing Hugging Face snapshot: $snapshot"
    local file
    for file in "${FILES[@]}"; do
        [ -f "$MODEL_DIR/$file" ] || cp -L "$snapshot/$file" "$MODEL_DIR/$file"
    done
    for file in "${SPEECH_FILES[@]}"; do
        if [ ! -f "$MODEL_DIR/speech_tokenizer/$file" ]; then
            cp -L "$snapshot/speech_tokenizer/$file" "$MODEL_DIR/speech_tokenizer/$file"
        fi
    done
}

download_from_hf() {
    echo "downloading from Hugging Face (~2.3 GB)…"
    "$ENGINE_DIR/download_model.sh" --model base-small --dir "$MODEL_DIR"
}

if [ ! -f "$MODEL_DIR/model.safetensors" ]; then
    copy_from_hf_cache || download_from_hf
fi

echo "==> verifying engine capabilities"
"$ENGINE_DIR/qwen_tts" --caps || true

echo ""
echo "Setup complete."
echo "  engine : $ENGINE_DIR/qwen_tts"
echo "  model  : $MODEL_DIR"
echo "Start the service with: npm run tts:dev"
