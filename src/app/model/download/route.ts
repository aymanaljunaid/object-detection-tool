/**
 * Model Download API Route
 * ========================
 * GET /api/models/download
 * 
 * Downloads the YOLOv8n model and converts to ONNX format.
 * This ensures the model is available for object detection.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const MODEL_DIR = path.join(process.cwd(), 'public', 'models');
const ONNX_PATH = path.join(MODEL_DIR, 'yolov8n.onnx');
const PT_PATH = path.join(MODEL_DIR, 'yolov8n.pt');
const MIN_MODEL_SIZE = 5 * 1024 * 1024; // 5MB minimum

// Ultralytics releases URL for .pt file
const PT_DOWNLOAD_URL = 'https://github.com/ultralytics/assets/releases/download/v8.4.0/yolov8n.pt';

async function convertPtToOnnx(): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if Python and ultralytics are available
    const script = `
from ultralytics import YOLO
import sys
model = YOLO('${PT_PATH}')
model.export(format='onnx', opset=12, simplify=True, dynamic=False, output='${ONNX_PATH}')
print('SUCCESS')
`;
    
    const { stdout, stderr } = await execAsync(`python3 -c "${script.replace(/\n/g, '; ')}"`, {
      timeout: 120000, // 2 minutes timeout
    });
    
    if (stdout.includes('SUCCESS') && fs.existsSync(ONNX_PATH)) {
      return { success: true };
    }
    
    return { success: false, error: stderr || 'Unknown conversion error' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

export async function GET(request: NextRequest) {
  try {
    // Ensure directory exists
    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
    }

    // Check if ONNX model already exists and is valid
    if (fs.existsSync(ONNX_PATH)) {
      const stats = fs.statSync(ONNX_PATH);
      if (stats.size >= MIN_MODEL_SIZE) {
        return NextResponse.json({
          success: true,
          message: 'Model already exists and is ready',
          path: '/models/yolov8n.onnx',
          size: stats.size,
          sizeMB: (stats.size / 1024 / 1024).toFixed(2) + 'MB',
        });
      } else {
        // Delete invalid/corrupted model
        console.log(`[Model Download] Removing corrupted model (${stats.size} bytes)`);
        fs.unlinkSync(ONNX_PATH);
      }
    }

    // Step 1: Download .pt file if not exists
    let ptNeedsDownload = !fs.existsSync(PT_PATH);
    if (fs.existsSync(PT_PATH)) {
      const ptStats = fs.statSync(PT_PATH);
      if (ptStats.size < 5 * 1024 * 1024) {
        ptNeedsDownload = true;
        fs.unlinkSync(PT_PATH);
      }
    }

    if (ptNeedsDownload) {
      console.log('[Model Download] Downloading YOLOv8n.pt from Ultralytics...');
      
      const response = await fetch(PT_DOWNLOAD_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/octet-stream' },
      });

      if (!response.ok) {
        throw new Error(`Failed to download .pt file: HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(PT_PATH, buffer);
      
      console.log(`[Model Download] Downloaded .pt file: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
    }

    // Step 2: Try to convert .pt to .onnx using Python
    console.log('[Model Download] Attempting to convert .pt to .onnx...');
    const convertResult = await convertPtToOnnx();

    if (convertResult.success && fs.existsSync(ONNX_PATH)) {
      const onnxStats = fs.statSync(ONNX_PATH);
      if (onnxStats.size >= MIN_MODEL_SIZE) {
        console.log(`[Model Download] Successfully converted to ONNX: ${(onnxStats.size / 1024 / 1024).toFixed(2)}MB`);
        return NextResponse.json({
          success: true,
          message: 'Model downloaded and converted successfully',
          path: '/models/yolov8n.onnx',
          size: onnxStats.size,
          sizeMB: (onnxStats.size / 1024 / 1024).toFixed(2) + 'MB',
        });
      }
    }

    // Conversion failed - provide instructions
    console.log('[Model Download] Auto-conversion failed, providing manual instructions');
    
    return NextResponse.json({
      success: false,
      error: 'Automatic conversion failed',
      ptFileReady: fs.existsSync(PT_PATH),
      ptPath: PT_PATH,
      instructions: {
        title: 'Manual ONNX Export Required',
        steps: [
          '1. Install ultralytics: pip install ultralytics',
          '2. Run this command:',
          `   python -c "from ultralytics import YOLO; YOLO('${PT_PATH}').export(format='onnx')"`,
          '3. Move the exported yolov8n.onnx to public/models/',
        ],
        alternative: 'Or download a pre-converted ONNX model from https://github.com/ultralytics/ultralytics',
      },
    }, { status: 500 });
  } catch (error) {
    console.error('[Model Download] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      instructions: {
        title: 'Manual Setup Required',
        steps: [
          '1. Install ultralytics: pip install ultralytics',
          '2. Run: yolo export model=yolov8n.pt format=onnx',
          '3. Move yolov8n.onnx to public/models/',
        ],
      },
    }, { status: 500 });
  }
}
