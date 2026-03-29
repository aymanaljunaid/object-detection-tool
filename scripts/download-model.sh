#!/bin/bash
# Download YOLOv8n ONNX Model
# ===========================

set -e

MODELS_DIR="public/models"
MODEL_FILE="yolov8n.onnx"
MODEL_PATH="$MODELS_DIR/$MODEL_FILE"

echo "============================================"
echo "YOLOv8 ONNX Model Downloader"
echo "============================================"

# Create models directory
mkdir -p "$MODELS_DIR"

# Check if file already exists and is valid
if [ -f "$MODEL_PATH" ]; then
    SIZE=$(stat -c%s "$MODEL_PATH" 2>/dev/null || stat -f%z "$MODEL_PATH" 2>/dev/null || echo "0")
    if [ "$SIZE" -gt 5000000 ]; then
        echo "✓ Model already exists ($(($SIZE / 1024 / 1024)) MB)"
        exit 0
    else
        echo "! Model file exists but is too small ($(($SIZE / 1024)) KB) - re-downloading"
        rm -f "$MODEL_PATH"
    fi
fi

echo ""
echo "Downloading YOLOv8n ONNX model..."
echo "File size: ~6MB"
echo ""

# Try multiple sources
SOURCES=(
    "https://huggingface.co/rocca/yolov8n-onnx-model/resolve/main/yolov8n.onnx"
    "https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n.onnx"
)

DOWNLOADED=false

for URL in "${SOURCES[@]}"; do
    echo "Trying: $URL"
    
    if command -v curl &> /dev/null; then
        if curl -L -o "$MODEL_PATH" --progress-bar "$URL" 2>/dev/null; then
            DOWNLOADED=true
            break
        fi
    elif command -v wget &> /dev/null; then
        if wget -O "$MODEL_PATH" "$URL" 2>/dev/null; then
            DOWNLOADED=true
            break
        fi
    fi
    
    echo "  Failed, trying next source..."
    rm -f "$MODEL_PATH"
done

if [ "$DOWNLOADED" = false ]; then
    echo ""
    echo "❌ Failed to download model automatically"
    echo ""
    echo "Please download manually:"
    echo "1. Go to: https://github.com/ultralytics/assets/releases/tag/v8.2.0"
    echo "2. Download yolov8n.onnx (~6MB)"
    echo "3. Place it in: public/models/yolov8n.onnx"
    echo ""
    exit 1
fi

# Verify download
SIZE=$(stat -c%s "$MODEL_PATH" 2>/dev/null || stat -f%z "$MODEL_PATH" 2>/dev/null || echo "0")

if [ "$SIZE" -lt 5000000 ]; then
    echo ""
    echo "❌ Downloaded file is too small ($(($SIZE / 1024)) KB)"
    echo "   The model file may be corrupted or incomplete"
    rm -f "$MODEL_PATH"
    exit 1
fi

echo ""
echo "============================================"
echo "✓ Model downloaded successfully!"
echo "  Path: $MODEL_PATH"
echo "  Size: $(($SIZE / 1024 / 1024)) MB"
echo "============================================"
