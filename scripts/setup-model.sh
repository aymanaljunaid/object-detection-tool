#!/bin/bash
#
# YOLOv8 Model Setup Script
# =========================
# This script downloads and exports the YOLOv8n model to ONNX format.
#
# Usage:
#   chmod +x scripts/setup-model.sh
#   ./scripts/setup-model.sh
#

set -e

echo "=========================================="
echo "YOLOv8 Model Setup Script"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Please install Python 3 first."
    exit 1
fi

# Create models directory
MODEL_DIR="public/models"
mkdir -p "$MODEL_DIR"

# Check if model already exists
if [ -f "$MODEL_DIR/yolov8n.onnx" ]; then
    SIZE=$(stat -f%z "$MODEL_DIR/yolov8n.onnx" 2>/dev/null || stat -c%s "$MODEL_DIR/yolov8n.onnx" 2>/dev/null)
    if [ "$SIZE" -gt 5000000 ]; then
        echo -e "${GREEN}Model already exists at $MODEL_DIR/yolov8n.onnx ($(numfmt --to=iec $SIZE))${NC}"
        echo "Model is ready to use. Refresh your browser to enable real detection."
        exit 0
    else
        echo -e "${YELLOW}Existing model file is too small ($SIZE bytes), re-downloading...${NC}"
        rm -f "$MODEL_DIR/yolov8n.onnx"
    fi
fi

# Check if ultralytics is installed
if ! python3 -c "import ultralytics" 2>/dev/null; then
    echo -e "${YELLOW}Ultralytics package not found. Installing...${NC}"
    pip install ultralytics || pip install --user ultralytics || {
        echo -e "${RED}Failed to install ultralytics. Please install it manually:${NC}"
        echo "  pip install ultralytics"
        exit 1
    }
fi

echo ""
echo "Step 1: Downloading YOLOv8n PyTorch model..."
python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')" || {
    echo -e "${RED}Failed to download model${NC}"
    exit 1
}

echo ""
echo "Step 2: Exporting to ONNX format..."
python3 -c "
from ultralytics import YOLO
model = YOLO('yolov8n.pt')
model.export(format='onnx', opset=12, simplify=True, dynamic=False)
print('Export complete!')
" || {
    echo -e "${RED}Failed to export model${NC}"
    exit 1
}

echo ""
echo "Step 3: Moving model to public/models/..."
if [ -f "yolov8n.onnx" ]; then
    mv yolov8n.onnx "$MODEL_DIR/"
    echo -e "${GREEN}Model moved to $MODEL_DIR/yolov8n.onnx${NC}"
elif [ -f "runs/detect/train/weights/best.onnx" ]; then
    cp runs/detect/train/weights/best.onnx "$MODEL_DIR/yolov8n.onnx"
    echo -e "${GREEN}Model copied to $MODEL_DIR/yolov8n.onnx${NC}"
else
    # Find any .onnx file that was created
    ONNX_FILE=$(find . -name "*.onnx" -type f -mmin -5 | head -1)
    if [ -n "$ONNX_FILE" ]; then
        cp "$ONNX_FILE" "$MODEL_DIR/yolov8n.onnx"
        echo -e "${GREEN}Model copied from $ONNX_FILE to $MODEL_DIR/yolov8n.onnx${NC}"
    else
        echo -e "${RED}Could not find exported ONNX model${NC}"
        exit 1
    fi
fi

# Verify
SIZE=$(stat -f%z "$MODEL_DIR/yolov8n.onnx" 2>/dev/null || stat -c%s "$MODEL_DIR/yolov8n.onnx" 2>/dev/null)
if [ "$SIZE" -gt 5000000 ]; then
    echo ""
    echo -e "${GREEN}=========================================="
    echo "SUCCESS! Model is ready."
    echo "==========================================${NC}"
    echo ""
    echo "Model path: $MODEL_DIR/yolov8n.onnx"
    echo "Model size: $(numfmt --to=iec $SIZE)"
    echo ""
    echo "Refresh your browser to enable real object detection."
else
    echo -e "${RED}Model file appears to be too small ($SIZE bytes)${NC}"
    echo "There may have been an error during export."
    exit 1
fi
