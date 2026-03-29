/**
 * Generation Token Utility
 * ========================
 * Provides async cancellation support to prevent stale operations
 * from affecting current state.
 * 
 * Use case: When a source is reconfigured, any pending async operations
 * (like HLS initialization) should be cancelled
 * to prevent race conditions.
 */

import { nanoid } from 'nanoid';
import type { GenerationToken } from '@/types';

/**
 * Create a new generation token
 */
export function createGenerationToken(): GenerationToken {
  const token: GenerationToken = {
    id: nanoid(8),
    cancelled: false,
    cancel: () => {},
  };
  
  token.cancel = () => {
    token.cancelled = true;
  };
  
  return token;
}

/**
 * Check if a generation token is still valid
 */
export function isTokenValid(token: GenerationToken | null | undefined): boolean {
  return token !== null && token !== undefined && !token.cancelled;
}

/**
 * Throw if token is cancelled (for use in async functions)
 */
export function throwIfCancelled(token: GenerationToken | null | undefined): void {
  if (!isTokenValid(token)) {
    throw new Error('Operation cancelled');
  }
}

/**
 * Create a cancellation controller that wraps a generation token
 */
export class CancellationController {
  private token: GenerationToken;
  private listeners: Array<() => void> = [];
  
  constructor() {
    this.token = createGenerationToken();
  }
  
  get isCancelled(): boolean {
    return this.token.cancelled;
  }
  
  getToken(): GenerationToken {
    return this.token;
  }
  
  cancel(): void {
    if (!this.token.cancelled) {
      this.token.cancel();
      this.listeners.forEach(listener => listener());
      this.listeners = [];
    }
  }
  
  onCancel(callback: () => void): void {
    if (this.token.cancelled) {
      callback();
    } else {
      this.listeners.push(callback);
    }
  }
  
  throwIfCancelled(): void {
    throwIfCancelled(this.token);
  }
}

/**
 * Utility to run async operations with cancellation support
 */
export async function withCancellation<T>(
  controller: CancellationController,
  operation: (checkCancelled: () => void) => Promise<T>
): Promise<T> {
  const checkCancelled = () => {
    if (controller.isCancelled) {
      throw new Error('Operation cancelled');
    }
  };
  
  return operation(checkCancelled);
}
