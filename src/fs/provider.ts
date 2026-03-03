import * as vscode from "vscode";
import {
  getObject,
  putObject,
  deleteObject,
  getObjectMetadata,
} from "../s3/ops";
import { listObjects } from "../s3/listing";
import {
  parseR2Uri,
  joinPath,
  isTextFile,
  isImageFile,
  isVideoFile,
} from "../util/paths";
import { getConfig } from "../s3/client";
import { S3Error } from "../types";

export class S3FileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._emitter.event;

  constructor() {}

  watch(
    uri: vscode.Uri,
    options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    // S3 doesn't support real-time watching, so return a dummy disposable
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    try {
      const { bucket, key } = parseR2Uri(uri.toString());

      if (!key || key === "") {
        // This is a bucket - treat as directory
        return {
          type: vscode.FileType.Directory,
          ctime: Date.now(),
          mtime: Date.now(),
          size: 0,
        };
      }

      if (key.endsWith("/")) {
        // This is a prefix (folder) - treat as directory
        return {
          type: vscode.FileType.Directory,
          ctime: Date.now(),
          mtime: Date.now(),
          size: 0,
        };
      }

      // This is an object - get its metadata
      const metadata = await getObjectMetadata(bucket, key);

      return {
        type: vscode.FileType.File,
        ctime: metadata.lastModified?.getTime() || Date.now(),
        mtime: metadata.lastModified?.getTime() || Date.now(),
        size: metadata.contentLength || 0,
      };
    } catch (error) {
      if (error instanceof S3Error && error.code === "NoSuchKey") {
        throw vscode.FileSystemError.FileNotFound(uri);
      }

      console.error("Error getting file stat:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    try {
      const { bucket, key } = parseR2Uri(uri.toString());
      const prefix = key && key !== "" ? key : undefined;

      const result = await listObjects(bucket, prefix);
      const entries: [string, vscode.FileType][] = [];

      // Add prefixes (folders)
      for (const prefixItem of result.prefixes) {
        let name = prefixItem.prefix;

        // Remove the parent prefix to get just the folder name
        if (prefix) {
          name = name.substring(prefix.length);
        }

        // Remove trailing slash
        name = name.replace(/\/$/, "");

        if (name) {
          entries.push([name, vscode.FileType.Directory]);
        }
      }

      // Add objects (files)
      for (const object of result.objects) {
        let name = object.key;

        // Remove the parent prefix to get just the file name
        if (prefix) {
          name = name.substring(prefix.length);
        }

        // Skip if this is not a direct child
        if (name.includes("/")) {
          continue;
        }

        if (name) {
          entries.push([name, vscode.FileType.File]);
        }
      }

      return entries;
    } catch (error) {
      console.error("Error reading directory:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    try {
      const { bucket, key } = parseR2Uri(uri.toString());

      if (!key) {
        throw vscode.FileSystemError.NoPermissions(
          "Cannot create buckets through filesystem"
        );
      }

      // Create a placeholder object to represent the directory
      const folderKey = key.endsWith("/") ? key : `${key}/`;
      await putObject(
        bucket,
        folderKey,
        new Uint8Array(0),
        "application/x-directory"
      );

      this._fireSoon({ type: vscode.FileChangeType.Created, uri });
    } catch (error) {
      console.error("Error creating directory:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const { bucket, key } = parseR2Uri(uri.toString());

      if (!key) {
        throw vscode.FileSystemError.FileIsADirectory(uri);
      }

      // Removed file size warning

      return await getObject(bucket, key);
    } catch (error) {
      if (error instanceof S3Error && error.code === "NoSuchKey") {
        throw vscode.FileSystemError.FileNotFound(uri);
      }

      if (error instanceof vscode.FileSystemError) {
        throw error;
      }

      console.error("Error reading file:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    try {
      const { bucket, key } = parseR2Uri(uri.toString());

      if (!key) {
        throw vscode.FileSystemError.FileIsADirectory(uri);
      }

      // Check if file exists if we're not allowed to overwrite
      if (!options.overwrite) {
        try {
          await getObjectMetadata(bucket, key);
          throw vscode.FileSystemError.FileExists(uri);
        } catch (error) {
          if (!(error instanceof S3Error && error.code === "NoSuchKey")) {
            throw error;
          }
          // File doesn't exist, which is what we want
        }
      }

      // Check if we're allowed to create new files
      if (!options.create) {
        try {
          await getObjectMetadata(bucket, key);
          // File exists, which is what we want
        } catch (error) {
          if (error instanceof S3Error && error.code === "NoSuchKey") {
            throw vscode.FileSystemError.FileNotFound(uri);
          }
          throw error;
        }
      }

      await putObject(bucket, key, content);

      this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        throw error;
      }

      console.error("Error writing file:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  async delete(
    uri: vscode.Uri,
    options: { recursive: boolean }
  ): Promise<void> {
    try {
      const { bucket, key } = parseR2Uri(uri.toString());

      if (!key) {
        throw vscode.FileSystemError.NoPermissions(
          "Cannot delete buckets through filesystem"
        );
      }

      const stat = await this.stat(uri);

      if (stat.type === vscode.FileType.Directory) {
        if (!options.recursive) {
          // Check if directory is empty
          const entries = await this.readDirectory(uri);
          if (entries.length > 0) {
            throw vscode.FileSystemError.NoPermissions("Directory not empty");
          }
        }

        if (options.recursive) {
          // Delete all contents recursively
          const result = await listObjects(bucket, key);

          const keysToDelete: string[] = [];

          // Add all objects
          for (const object of result.objects) {
            keysToDelete.push(object.key);
          }

          // Add all prefixes (as empty objects)
          for (const prefix of result.prefixes) {
            keysToDelete.push(prefix.prefix);
          }

          // Batch delete
          if (keysToDelete.length > 0) {
            for (let i = 0; i < keysToDelete.length; i += 1000) {
              const batch = keysToDelete.slice(i, i + 1000);
              await Promise.all(batch.map((k) => deleteObject(bucket, k)));
            }
          }
        }

        // Delete the directory marker if it exists
        try {
          await deleteObject(bucket, key.endsWith("/") ? key : `${key}/`);
        } catch (error) {
          // Ignore if the directory marker doesn't exist
        }
      } else {
        // Delete single file
        await deleteObject(bucket, key);
      }

      this._fireSoon({ type: vscode.FileChangeType.Deleted, uri });
    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        throw error;
      }

      console.error("Error deleting:", error);
      throw vscode.FileSystemError.Unavailable(uri);
    }
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    try {
      const oldParsed = parseR2Uri(oldUri.toString());
      const newParsed = parseR2Uri(newUri.toString());

      if (!oldParsed.key || !newParsed.key) {
        throw vscode.FileSystemError.NoPermissions("Cannot rename buckets");
      }

      if (oldParsed.bucket !== newParsed.bucket) {
        throw vscode.FileSystemError.NoPermissions(
          "Cannot rename across buckets"
        );
      }

      // Check if target exists and handle overwrite
      if (!options.overwrite) {
        try {
          await getObjectMetadata(newParsed.bucket, newParsed.key);
          throw vscode.FileSystemError.FileExists(newUri);
        } catch (error) {
          if (!(error instanceof S3Error && error.code === "NoSuchKey")) {
            throw error;
          }
          // Target doesn't exist, which is what we want
        }
      }

      const stat = await this.stat(oldUri);

      if (stat.type === vscode.FileType.Directory) {
        // Rename directory - need to rename all contents
        const result = await listObjects(oldParsed.bucket, oldParsed.key);

        // Copy all objects with new prefix
        for (const object of result.objects) {
          const newKey = object.key.replace(oldParsed.key, newParsed.key);
          const objectData = await getObject(oldParsed.bucket, object.key);
          await putObject(newParsed.bucket, newKey, objectData);
          await deleteObject(oldParsed.bucket, object.key);
        }

        // Handle directory marker
        try {
          const oldDirKey = oldParsed.key.endsWith("/")
            ? oldParsed.key
            : `${oldParsed.key}/`;
          const newDirKey = newParsed.key.endsWith("/")
            ? newParsed.key
            : `${newParsed.key}/`;

          await putObject(
            newParsed.bucket,
            newDirKey,
            new Uint8Array(0),
            "application/x-directory"
          );
          await deleteObject(oldParsed.bucket, oldDirKey);
        } catch (error) {
          // Ignore if directory marker operations fail
        }
      } else {
        // Rename single file
        const data = await getObject(oldParsed.bucket, oldParsed.key);
        await putObject(newParsed.bucket, newParsed.key, data);
        await deleteObject(oldParsed.bucket, oldParsed.key);
      }

      this._fireSoon(
        { type: vscode.FileChangeType.Deleted, uri: oldUri },
        { type: vscode.FileChangeType.Created, uri: newUri }
      );
    } catch (error) {
      if (error instanceof vscode.FileSystemError) {
        throw error;
      }

      console.error("Error renaming:", error);
      throw vscode.FileSystemError.Unavailable(oldUri);
    }
  }

  // Helper method to batch and delay file change events
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timeout;

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }
}
