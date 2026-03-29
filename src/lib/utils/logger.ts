/**
 * Debug Logger Utility
 * ====================
 * Centralized logging with performance monitoring and conditional output.
 */

import { DEBUG_CONFIG } from '@/lib/constants';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
  timestamp: number;
}

class DebugLogger {
  private enabled: boolean;
  private prefix: string;
  private entries: LogEntry[] = [];
  private maxEntries = 1000;
  private performanceMarks = new Map<string, number>();

  constructor() {
    this.enabled = DEBUG_CONFIG.enableLogging;
    this.prefix = DEBUG_CONFIG.logPrefix;
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Log a debug message (development only)
   */
  debug(category: string, message: string, data?: unknown): void {
    if (this.enabled) {
      this.log('debug', category, message, data);
    }
  }

  /**
   * Log an info message
   */
  info(category: string, message: string, data?: unknown): void {
    this.log('info', category, message, data);
  }

  /**
   * Log a warning message
   */
  warn(category: string, message: string, data?: unknown): void {
    this.log('warn', category, message, data);
  }

  /**
   * Log an error message
   */
  error(category: string, message: string, data?: unknown): void {
    this.log('error', category, message, data);
  }

  /**
   * Start a performance measurement
   */
  startMeasure(id: string): void {
    this.performanceMarks.set(id, performance.now());
  }

  /**
   * End a performance measurement and log the duration
   */
  endMeasure(id: string, category: string, message: string): number {
    const start = this.performanceMarks.get(id);
    if (start === undefined) {
      this.warn('performance', `No start mark found for ${id}`);
      return 0;
    }
    const duration = performance.now() - start;
    this.performanceMarks.delete(id);
    
    if (this.enabled) {
      this.debug(category, `${message} (${duration.toFixed(2)}ms)`);
    }
    
    return duration;
  }

  /**
   * Get all log entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear log entries
   */
  clearEntries(): void {
    this.entries = [];
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, category: string, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      category,
      message,
      data,
      timestamp: Date.now(),
    };

    // Store entry
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Console output
    const formattedMessage = `${this.prefix}[${category}] ${message}`;
    
    switch (level) {
      case 'debug':
        if (data !== undefined) {
          console.debug(formattedMessage, data);
        } else {
          console.debug(formattedMessage);
        }
        break;
      case 'info':
        if (data !== undefined) {
          console.info(formattedMessage, data);
        } else {
          console.info(formattedMessage);
        }
        break;
      case 'warn':
        if (data !== undefined) {
          console.warn(formattedMessage, data);
        } else {
          console.warn(formattedMessage);
        }
        break;
      case 'error':
        if (data !== undefined) {
          console.error(formattedMessage, data);
        } else {
          console.error(formattedMessage);
        }
        break;
    }
  }
}

// Export singleton instance
export const logger = new DebugLogger();

// Category constants for consistent usage
export const LOG_CATEGORIES = {
  PLAYBACK: 'playback',
  DETECTION: 'detection',
  SOURCE: 'source',
  OVERLAY: 'overlay',
  WEBCAM: 'webcam',
  HLS: 'hls',
  PERFORMANCE: 'performance',
  STATE: 'state',
} as const;
