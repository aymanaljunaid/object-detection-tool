#!/usr/bin/env python3
"""
YOLOv8 ONNX Model Export Script
================================

This script downloads and exports the YOLOv8n model to ONNX format.
Run this script once before starting the application.

Usage:
    python scripts/get_model.py

Requirements:
    pip install ultralytics onnx
"""

import os
import sys
import urllib.request
import ssl

# Target path
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
MODEL_DIR = os.path.join(PROJECT_ROOT, "public", "models")
MODEL_PATH = os.path.join(MODEL_DIR, "yolov8n.onnx")

# Minimum expected model size (5MB)
MIN_SIZE = 5 * 1024 * 1024

def download_with_ultralytics():
    """Use ultralytics library to download and export model."""
    try:
        from ultralytics import YOLO
        print("✓ ultralytics package found")
        
        # Load model (this will download .pt file if not present)
        print("Loading YOLOv8n model (downloading if needed)...")
        model = YOLO("yolov8n.pt")
        
        # Export to ONNX
        print("Exporting to ONNX format...")
        export_path = model.export(format="onnx", opset=12, simplify=True, dynamic=False)
        
        # Move to target location
        os.makedirs(MODEL_DIR, exist_ok=True)
        if os.path.exists(export_path):
            import shutil
            shutil.copy(export_path, MODEL_PATH)
            print(f"✓ Model exported to: {MODEL_PATH}")
            return True
        else:
            print(f"✗ Export file not found: {export_path}")
            return False
            
    except ImportError:
        print("✗ ultralytics package not installed")
        print("  Install with: pip install ultralytics")
        return False
    except Exception as e:
        print(f"✗ Export failed: {e}")
        return False

def download_from_url():
    """Download pre-converted ONNX model from URL."""
    # List of potential sources (you may need to update these)
    sources = [
        # Add working URLs here when found
    ]
    
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    
    for url in sources:
        try:
            print(f"Trying: {url}")
            os.makedirs(MODEL_DIR, exist_ok=True)
            
            urllib.request.urlretrieve(url, MODEL_PATH)
            
            size = os.path.getsize(MODEL_PATH)
            if size >= MIN_SIZE:
                print(f"✓ Downloaded model ({size / 1024 / 1024:.2f} MB)")
                return True
            else:
                print(f"✗ File too small ({size} bytes)")
                os.remove(MODEL_PATH)
                
        except Exception as e:
            print(f"✗ Download failed: {e}")
            if os.path.exists(MODEL_PATH):
                os.remove(MODEL_PATH)
    
    return False

def main():
    print("=" * 60)
    print("YOLOv8n ONNX Model Export Tool")
    print("=" * 60)
    print()
    
    # Check if model already exists
    if os.path.exists(MODEL_PATH):
        size = os.path.getsize(MODEL_PATH)
        if size >= MIN_SIZE:
            print(f"✓ Model already exists: {MODEL_PATH}")
            print(f"  Size: {size / 1024 / 1024:.2f} MB")
            return 0
        else:
            print(f"! Existing model too small ({size} bytes), re-downloading...")
            os.remove(MODEL_PATH)
    
    print(f"Target path: {MODEL_PATH}")
    print()
    
    # Try ultralytics export first
    print("Method 1: Export using ultralytics library")
    print("-" * 40)
    if download_with_ultralytics():
        print()
        print("=" * 60)
        print("SUCCESS! Model is ready for use.")
        print("=" * 60)
        return 0
    
    print()
    
    # Try direct download
    print("Method 2: Direct download from URL")
    print("-" * 40)
    if download_from_url():
        print()
        print("=" * 60)
        print("SUCCESS! Model is ready for use.")
        print("=" * 60)
        return 0
    
    # Manual instructions
    print()
    print("=" * 60)
    print("MANUAL SETUP REQUIRED")
    print("=" * 60)
    print()
    print("Automatic download failed. Please follow these steps:")
    print()
    print("1. Install ultralytics:")
    print("   pip install ultralytics")
    print()
    print("2. Export the model:")
    print("   python -c \"from ultralytics import YOLO; YOLO('yolov8n.pt').export(format='onnx')\"")
    print()
    print("3. Copy the exported model:")
    print("   cp yolov8n.onnx public/models/")
    print()
    print("Or download a pre-converted model from:")
    print("   https://github.com/ultralytics/ultralytics")
    print()
    print("=" * 60)
    
    return 1

if __name__ == "__main__":
    sys.exit(main())
