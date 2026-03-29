'use client';

import React, { useRef, useEffect, useCallback, memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { clampRect } from '@/lib/utils/coordinates';
import type { Detection, Dimensions } from '@/types';

interface DetectionOverlayProps {
  sourceId: string;
  videoWidth: number;
  videoHeight: number;
  className?: string;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function getCompactLabel(detection: Detection): string {
  const recognizedName = detection.faceRecognition?.identityName?.trim();
  const isRecognizedPerson = detection.className === 'person' && !!recognizedName;

  const labelName = isRecognizedPerson
    ? recognizedName!
    : detection.className;

  const labelConfidence = isRecognizedPerson
    ? detection.faceRecognition?.confidence ?? detection.confidence
    : detection.confidence;

  return `${labelName.toUpperCase()} ${Math.round(labelConfidence * 100)}%`;
}

function drawSurveillanceBox(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  color: string
): void {
  const { x, y, width, height } = rect;
  const corner = Math.max(12, Math.min(width, height) * 0.18);

  ctx.save();

  // faint full box
  ctx.strokeStyle = 'rgba(108, 245, 255, 0.30)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, width, height);

  // corner brackets
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();

  // top-left
  ctx.moveTo(x, y + corner);
  ctx.lineTo(x, y);
  ctx.lineTo(x + corner, y);

  // top-right
  ctx.moveTo(x + width - corner, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + corner);

  // bottom-right
  ctx.moveTo(x + width, y + height - corner);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x + width - corner, y + height);

  // bottom-left
  ctx.moveTo(x + corner, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + height - corner);

  ctx.stroke();

  // tiny HUD ticks
  const tick = 6;
  ctx.beginPath();
  ctx.moveTo(x + corner + 10, y);
  ctx.lineTo(x + corner + 10 + tick, y);

  ctx.moveTo(x + width - corner - 10 - tick, y);
  ctx.lineTo(x + width - corner - 10, y);

  ctx.moveTo(x, y + corner + 10);
  ctx.lineTo(x, y + corner + 10 + tick);

  ctx.moveTo(x + width, y + corner + 10);
  ctx.lineTo(x + width, y + corner + 10 + tick);
  ctx.stroke();

  ctx.restore();
}

function drawTopLabel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  accentColor: string
): void {
  const fontSize = 12;
  const paddingX = 10;
  const paddingY = 6;

  ctx.save();
  ctx.font = `700 ${fontSize}px monospace`;
  ctx.textBaseline = 'top';

  const textWidth = ctx.measureText(label).width;
  const labelWidth = textWidth + paddingX * 2 + 8;
  const labelHeight = fontSize + paddingY * 2;

  let labelX = rect.x;
  let labelY = rect.y - labelHeight - 8;

  // if too high, place inside near top
  if (labelY < 6) {
    labelY = rect.y + 6;
  }

  // keep inside canvas horizontally
  const canvasWidth = ctx.canvas.width / (window.devicePixelRatio || 1);
  if (labelX + labelWidth > canvasWidth - 6) {
    labelX = canvasWidth - labelWidth - 6;
  }
  if (labelX < 6) {
    labelX = 6;
  }

  // background
  ctx.fillStyle = 'rgba(200, 235, 245, 0.12)';
  drawRoundedRect(ctx, labelX, labelY, labelWidth, labelHeight, 4);
  ctx.fill();

  // border
  ctx.strokeStyle = 'rgba(170, 235, 255, 0.35)';
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, labelX, labelY, labelWidth, labelHeight, 4);
  ctx.stroke();

  // accent strip
  ctx.fillStyle = accentColor;
  ctx.fillRect(labelX, labelY, 3, labelHeight);

  // text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, labelX + paddingX, labelY + paddingY - 1);

  ctx.restore();
}

function drawDetection(
  ctx: CanvasRenderingContext2D,
  detection: Detection,
  displayBox: Rect
): void {
  const color = '#0051ff';
  const label = getCompactLabel(detection);

  ctx.save();

  // subtle target fill
  ctx.fillStyle = 'rgba(49, 157, 247, 0.27)';
  ctx.fillRect(displayBox.x, displayBox.y, displayBox.width, displayBox.height);

  drawSurveillanceBox(ctx, displayBox, color);
  drawTopLabel(ctx, displayBox, label, color);

  ctx.restore();
}

export const DetectionOverlay = memo(function DetectionOverlay({
  sourceId,
  videoWidth,
  videoHeight,
  className = '',
}: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDetectionsRef = useRef<Detection[]>([]);
  const rafRef = useRef<number | null>(null);

  const lastDetections = useAppStore((state) => {
    const source = state.sources.get(sourceId);
    return source?.lastDetections ?? null;
  });

  // Bug 9 fix: bbox is top-left format {x, y, width, height} — no center offset needed.
  // Previous code subtracted width/2 and height/2 treating it as center-format,
  // which shifted every box up and to the left by half its own size.
  const mapDetectionToDisplayCoords = useCallback(
    (detection: Detection, displaySize: Dimensions): Rect => {
      return {
        x: detection.bbox.x * displaySize.width,
        y: detection.bbox.y * displaySize.height,
        width: detection.bbox.width * displaySize.width,
        height: detection.bbox.height * displaySize.height,
      };
    },
    []
  );

  const renderDetections = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || videoWidth === 0 || videoHeight === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, videoWidth, videoHeight);

    const detections = lastDetectionsRef.current;
    if (detections.length === 0) {
      ctx.restore();
      return;
    }

    const displaySize: Dimensions = {
      width: videoWidth,
      height: videoHeight,
    };

    detections.forEach((detection) => {
      const displayBox = mapDetectionToDisplayCoords(detection, displaySize);
      const clampedBox = clampRect(displayBox, displaySize);

      if (clampedBox.width <= 1 || clampedBox.height <= 1) return;
      drawDetection(ctx, detection, clampedBox);
    });

    ctx.restore();
  }, [videoWidth, videoHeight, mapDetectionToDisplayCoords]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.floor(videoWidth * dpr));
    canvas.height = Math.max(1, Math.floor(videoHeight * dpr));
    canvas.style.width = `${videoWidth}px`;
    canvas.style.height = `${videoHeight}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    renderDetections();
  }, [videoWidth, videoHeight, renderDetections]);

  useEffect(() => {
    lastDetectionsRef.current = lastDetections?.detections ?? [];

    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        renderDetections();
        rafRef.current = null;
      });
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [lastDetections, renderDetections]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        width: videoWidth,
        height: videoHeight,
      }}
    />
  );
});

interface DetectionStatsProps {
  sourceId: string;
}

export const DetectionStats = memo(function DetectionStats({
  sourceId,
}: DetectionStatsProps) {
  const lastDetections = useAppStore((state) => {
    const source = state.sources.get(sourceId);
    return source?.lastDetections ?? null;
  });

  if (!lastDetections) return null;

  const now = new Date();
  const clock = now.toLocaleTimeString('en-GB', { hour12: false });

  return (
    <div className="absolute bottom-2 left-2 rounded-sm border border-cyan-200/30 bg-slate-100/10 px-3 py-2 font-mono text-[11px] text-cyan-50 shadow-sm backdrop-blur-sm">
      <div className="opacity-90">SYSTEM RECOGNITION ACTIVE</div>
      <div className="mt-1 flex gap-3 text-cyan-100/90">
        <span>OBJECTS {lastDetections.detections.length}</span>
        <span>{lastDetections.inferenceTime.toFixed(1)}ms</span>
        <span>{clock}</span>
      </div>
    </div>
  );
});
