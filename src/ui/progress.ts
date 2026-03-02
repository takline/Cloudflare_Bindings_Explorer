import * as vscode from "vscode";
import { ProgressReporter } from "../types";

export interface ProgressOptions {
  title: string;
  location?: vscode.ProgressLocation;
  cancellable?: boolean;
  modal?: boolean;
}

export class ProgressTracker implements ProgressReporter {
  private currentValue = 0;
  private lastMessage = "";

  constructor(
    private progress: vscode.Progress<{ message?: string; increment?: number }>,
    private token?: vscode.CancellationToken
  ) {}

  report(value: { message?: string; increment?: number }): void {
    // Calculate increment if not provided
    if (value.increment !== undefined) {
      this.currentValue += value.increment;
    } else if (value.message && value.message !== this.lastMessage) {
      // Auto-increment for message changes
      const autoIncrement = Math.max(1, Math.min(10, 100 - this.currentValue));
      this.currentValue += autoIncrement;
      value.increment = autoIncrement;
    }

    // Ensure we don't exceed 100%
    if (this.currentValue > 100) {
      this.currentValue = 100;
    }

    this.lastMessage = value.message || this.lastMessage;
    this.progress.report(value);
  }

  setProgress(percentage: number, message?: string): void {
    const increment = percentage - this.currentValue;
    this.currentValue = percentage;

    this.progress.report({
      increment: increment > 0 ? increment : undefined,
      message,
    });

    if (message) {
      this.lastMessage = message;
    }
  }

  isCompleted(): boolean {
    return this.currentValue >= 100;
  }

  isCancellationRequested(): boolean {
    return this.token?.isCancellationRequested || false;
  }
}

export async function withProgress<T>(
  options: ProgressOptions,
  operation: (
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<T>
): Promise<T> {
  const progressOptions: vscode.ProgressOptions = {
    location: options.location || vscode.ProgressLocation.Notification,
    title: options.title,
    cancellable: options.cancellable || false,
  };

  return vscode.window.withProgress(
    progressOptions,
    async (progress, token) => {
      const tracker = new ProgressTracker(progress, token);

      try {
        const result = await operation(tracker, token);

        // Ensure progress reaches 100% on success
        if (!tracker.isCompleted()) {
          tracker.setProgress(100, "Completed");
        }

        return result;
      } catch (error) {
        // Report error in progress
        tracker.report({
          message: `Error: ${error instanceof Error ? error.message : error}`,
        });
        throw error;
      }
    }
  );
}

export async function withProgressBatch<T>(
  options: ProgressOptions,
  items: T[],
  operation: (
    item: T,
    index: number,
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  return withProgress(options, async (progress, token) => {
    for (let i = 0; i < items.length; i++) {
      if (token.isCancellationRequested) {
        throw new Error("Operation cancelled");
      }

      const item = items[i];
      const percentage = Math.round(((i + 1) / items.length) * 100);

      progress.setProgress(
        percentage,
        `Processing ${i + 1} of ${items.length}`
      );

      await operation(item, i, progress, token);
    }
  });
}

// Specialized progress functions for common S3 operations

export async function withUploadProgress<T>(
  operation: (
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<T>,
  fileName?: string
): Promise<T> {
  const title = fileName ? `Uploading ${fileName}` : "Uploading file";

  return withProgress(
    {
      title,
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
    },
    operation
  );
}

export async function withDownloadProgress<T>(
  operation: (
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<T>,
  fileName?: string
): Promise<T> {
  const title = fileName ? `Downloading ${fileName}` : "Downloading file";

  return withProgress(
    {
      title,
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
    },
    operation
  );
}

export async function withDeleteProgress<T>(
  operation: (
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<T>,
  itemCount?: number
): Promise<T> {
  const title = itemCount
    ? `Deleting ${itemCount} item${itemCount > 1 ? "s" : ""}`
    : "Deleting items";

  return withProgress(
    {
      title,
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
    },
    operation
  );
}

export async function withCopyProgress<T>(
  operation: (
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<T>,
  itemCount?: number
): Promise<T> {
  const title = itemCount
    ? `Copying ${itemCount} item${itemCount > 1 ? "s" : ""}`
    : "Copying items";

  return withProgress(
    {
      title,
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
    },
    operation
  );
}

export async function withMoveProgress<T>(
  operation: (
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<T>,
  itemCount?: number
): Promise<T> {
  const title = itemCount
    ? `Moving ${itemCount} item${itemCount > 1 ? "s" : ""}`
    : "Moving items";

  return withProgress(
    {
      title,
      location: vscode.ProgressLocation.Notification,
      cancellable: true,
    },
    operation
  );
}

export async function withListingProgress<T>(
  operation: (
    progress: ProgressTracker,
    token: vscode.CancellationToken
  ) => Promise<T>,
  bucket?: string
): Promise<T> {
  const title = bucket ? `Loading ${bucket}` : "Loading S3 data";

  return withProgress(
    {
      title,
      location: vscode.ProgressLocation.Window,
      cancellable: false,
    },
    operation
  );
}

// Utility to create a simple progress reporter for external use
export function createProgressReporter(
  title: string,
  location: vscode.ProgressLocation = vscode.ProgressLocation.Notification
): Promise<ProgressTracker> {
  return new Promise((resolve) => {
    vscode.window.withProgress(
      {
        location,
        title,
        cancellable: true,
      },
      async (progress, token) => {
        const tracker = new ProgressTracker(progress, token);
        resolve(tracker);

        // Keep the progress open until explicitly closed
        return new Promise<void>((resolveProgress) => {
          const checkInterval = setInterval(() => {
            if (token.isCancellationRequested || tracker.isCompleted()) {
              clearInterval(checkInterval);
              resolveProgress();
            }
          }, 100);
        });
      }
    );
  });
}

// Utility for file size-based progress tracking
export function calculateFileProgress(
  transferred: number,
  total: number
): number {
  if (total === 0) {return 100;}
  return Math.min(100, Math.round((transferred / total) * 100));
}

// Utility for multi-part upload progress
export class MultipartProgressTracker {
  private completedParts = 0;

  constructor(
    private totalParts: number,
    private progressReporter: ProgressTracker
  ) {}

  reportPartCompleted(partNumber: number): void {
    this.completedParts++;
    const percentage = Math.round(
      (this.completedParts / this.totalParts) * 100
    );

    this.progressReporter.setProgress(
      percentage,
      `Uploaded part ${this.completedParts} of ${this.totalParts}`
    );
  }

  isCompleted(): boolean {
    return this.completedParts >= this.totalParts;
  }
}
