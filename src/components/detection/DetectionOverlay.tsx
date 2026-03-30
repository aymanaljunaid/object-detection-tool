'use client';

import { useRef, useEffect, useCallback, memo } from 'react';
import { useAppStore } from '@/store/appStore';
import { overlayBus } from '@/lib/overlayBus';
import { clampRect } from '@/lib/utils/coordinates';
import type { Detection, DetectionResult, Dimensions } from '@/types';

interface DetectionOverlayProps {
  sourceId: string;
  videoWidth: number;
  videoHeight: number;
  className?: string;
}

interface Rect { x: number; y: number; width: number; height: number; }

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const cr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + cr, y);
  ctx.lineTo(x + w - cr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + cr);
  ctx.lineTo(x + w, y + h - cr); ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
  ctx.lineTo(x + cr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - cr);
  ctx.lineTo(x, y + cr); ctx.quadraticCurveTo(x, y, x + cr, y);
  ctx.closePath();
}

function getCompactLabel(d: Detection): string {
  const rName = d.faceRecognition?.identityName?.trim();
  const isPerson = d.className === 'person' && !!rName;
  const name = isPerson ? rName! : d.className;
  const conf = isPerson ? (d.faceRecognition?.confidence ?? d.confidence) : d.confidence;
  return `${name.toUpperCase()} ${Math.round(conf * 100)}%`;
}

function drawSurveillanceBox(ctx: CanvasRenderingContext2D, r: Rect, color: string) {
  const { x, y, width: w, height: h } = r;
  const c = Math.max(12, Math.min(w, h) * 0.18);
  ctx.save();
  ctx.strokeStyle = 'rgba(108,245,255,0.30)'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]); ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
  ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
  ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
  ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
  ctx.stroke();
  ctx.restore();
}

function drawTopLabel(ctx: CanvasRenderingContext2D, r: Rect, label: string, accent: string) {
  const fs = 12, px = 10, py = 6;
  ctx.save();
  ctx.font = `700 ${fs}px monospace`; ctx.textBaseline = 'top';
  const tw = ctx.measureText(label).width;
  const lw = tw + px * 2 + 8, lh = fs + py * 2;
  let lx = r.x, ly = r.y - lh - 8;
  if (ly < 6) ly = r.y + 6;
  const cw = ctx.canvas.width / (window.devicePixelRatio || 1);
  if (lx + lw > cw - 6) lx = cw - lw - 6;
  if (lx < 6) lx = 6;
  ctx.fillStyle = 'rgba(200,235,245,0.12)'; drawRoundedRect(ctx, lx, ly, lw, lh, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(170,235,255,0.35)'; ctx.lineWidth = 1; drawRoundedRect(ctx, lx, ly, lw, lh, 4); ctx.stroke();
  ctx.fillStyle = accent; ctx.fillRect(lx, ly, 3, lh);
  ctx.fillStyle = '#ffffff'; ctx.fillText(label, lx + px, ly + py - 1);
  ctx.restore();
}

function drawDetection(ctx: CanvasRenderingContext2D, d: Detection, box: Rect) {
  const color = '#0051ff';
  ctx.save();
  ctx.fillStyle = 'rgba(49,157,247,0.27)';
  ctx.fillRect(box.x, box.y, box.width, box.height);
  drawSurveillanceBox(ctx, box, color);
  drawTopLabel(ctx, box, getCompactLabel(d), color);
  ctx.restore();
}

export const DetectionOverlay = memo(function DetectionOverlay({
  sourceId, videoWidth, videoHeight, className = '',
}: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const paint = useCallback((detections: Detection[], w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const displaySize: Dimensions = { width: w, height: h };
    for (const d of detections) {
      const box = clampRect(
        { x: d.bbox.x * w, y: d.bbox.y * h, width: d.bbox.width * w, height: d.bbox.height * h },
        displaySize
      );
      if (box.width > 1 && box.height > 1) drawDetection(ctx, d, box);
    }
    ctx.restore();
  }, []);

  // Register direct-draw callback on the overlay bus — fires immediately
  // when the worker result arrives, no Zustand->React re-render cycle.
  useEffect(() => {
    const w = videoWidth, h = videoHeight;
    overlayBus.register(sourceId, (result: DetectionResult) => {
      paint(result.detections, w, h);
    });
    return () => overlayBus.unregister(sourceId);
  }, [sourceId, videoWidth, videoHeight, paint]);

  // Resize canvas when video dimensions change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(videoWidth * dpr));
    canvas.height = Math.max(1, Math.floor(videoHeight * dpr));
    canvas.style.width = `${videoWidth}px`;
    canvas.style.height = `${videoHeight}px`;
  }, [videoWidth, videoHeight]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ width: videoWidth, height: videoHeight }}
    />
  );
});

interface DetectionStatsProps { sourceId: string; }

export const DetectionStats = memo(function DetectionStats({ sourceId }: DetectionStatsProps) {
  const lastDetections = useAppStore((state) => state.sources.get(sourceId)?.lastDetections ?? null);
  if (!lastDetections) return null;
  const clock = new Date().toLocaleTimeString('en-GB', { hour12: false });
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
