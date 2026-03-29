/**
 * Model Status API Route
 * ======================
 * GET /api/models/status
 * 
 * Checks if the YOLOv8 model is available and returns its status.
 */

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MODEL_DIR = path.join(process.cwd(), 'public', 'models');
const MODEL_PATH = path.join(MODEL_DIR, 'yolov8n.onnx');
const MIN_MODEL_SIZE = 100; // 100 bytes minimum (just check not empty)

export async function GET() {
  try {
    // Check if directory exists
    if (!fs.existsSync(MODEL_DIR)) {
      return NextResponse.json({
        available: false,
        reason: 'Models directory does not exist',
        modelPath: '/models/yolov8n.onnx',
      });
    }

    // Check if model file exists
    if (!fs.existsSync(MODEL_PATH)) {
      return NextResponse.json({
        available: false,
        reason: 'Model file not found',
        modelPath: '/models/yolov8n.onnx',
        downloadEndpoint: '/api/models/download',
      });
    }

    // Check file size
    const stats = fs.statSync(MODEL_PATH);
    
    if (stats.size === 0) {
      return NextResponse.json({
        available: false,
        reason: 'Model file is empty (0 bytes)',
        modelPath: '/models/yolov8n.onnx',
        downloadEndpoint: '/api/models/download',
      });
    }

    if (stats.size < MIN_MODEL_SIZE) {
      return NextResponse.json({
        available: false,
        reason: `Model file too small (${(stats.size / 1024).toFixed(1)}KB) - likely corrupted`,
        modelPath: '/models/yolov8n.onnx',
        currentSize: stats.size,
        expectedMinSize: MIN_MODEL_SIZE,
        downloadEndpoint: '/api/models/download',
      });
    }

    // Model is valid
    return NextResponse.json({
      available: true,
      reason: 'Model file is valid and ready',
      modelPath: '/models/yolov8n.onnx',
      size: stats.size,
      sizeMB: (stats.size / 1024 / 1024).toFixed(2) + 'MB',
    });
  } catch (error) {
    return NextResponse.json({
      available: false,
      reason: error instanceof Error ? error.message : 'Unknown error checking model status',
      modelPath: '/models/yolov8n.onnx',
    }, { status: 500 });
  }
}