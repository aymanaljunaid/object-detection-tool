#!/usr/bin/env python3
"""
Download and export YOLOv8n ONNX model.

This script downloads the YOLOv8n model and exports it to ONNX format.
Run this script before starting the application if automatic download fails.

Usage:
    python scripts/download-model.py
"""

import os
import sys
import urllib.request
import shutil

# Try to use ultralytics to export the model
def export_with_ultralytics():
    try:
        from ultralytics import YOLO
        
        print("Loading YOLOv8n model...")
        model = YOLO("yolov8n.pt")
        
        print("Exporting to ONNX format...")
        model.export(format="onnx", opset=12, simplify=True)
        
        # Find the exported model
        model_path = "yolov8n.onnx"
        if os.path.exists(model_path):
            dest_dir = "public/models"
            os.makedirs(dest_dir, exist_ok=True)
            dest_path = os.path.join(dest_dir, "yolov8n.onnx")
            shutil.move(model_path, dest_path)
            print(f"Model exported to: {dest_path}")
            return True
        return False
    except ImportError:
        print("ultralytics package not installed. Trying direct download...")
        return False
    except Exception as e:
        print(f"Error exporting model: {e}")
        return False

# Direct download from mirrors
def download_from_mirror():
    mirrors = [
        ("https://objectstorage.ap-seoul-1.oraclecloud.com/n/axwwuosgqqep/b/yolov8-models/o/yolov8n.onnx", "Oracle Cloud Mirror"),
        # Add more mirrors as needed
    ]
    
    dest_dir = "public/models"
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, "yolov8n.onnx")
    
    for url, name in mirrors:
        try:
            print(f"Trying {name}...")
            urllib.request.urlretrieve(url, dest_path)
            
            # Check file size
            size = os.path.getsize(dest_path)
            if size > 5_000_000:  # 5MB minimum
                print(f"Successfully downloaded model ({size / 1024 / 1024:.2f}MB)")
                return True
            else:
                print(f"Downloaded file too small ({size} bytes), trying next mirror...")
                os.remove(dest_path)
        except Exception as e:
            print(f"Failed to download from {name}: {e}")
    
    return False

def main():
    print("=" * 60)
    print("YOLOv8n ONNX Model Downloader")
    print("=" * 60)
    
    # First try ultralytics export
    if export_with_ultralytics():
        print("\nSuccess! Model is ready.")
        return 0
    
    # Then try direct download
    if download_from_mirror():
        print("\nSuccess! Model is ready.")
        return 0
    
    print("\n" + "=" * 60)
    print("Automatic download failed. Please download manually:")
    print("=" * 60)
    print("\n1. Install ultralytics: pip install ultralytics")
    print("2. Run: yolo export model=yolov8n.pt format=onnx")
    print("3. Move yolov8n.onnx to public/models/")
    print("\nOr download from:")
    print("https://github.com/ultralytics/ultralytics")
    print("=" * 60)
    
    return 1

if __name__ == "__main__":
    sys.exit(main())
