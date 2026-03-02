/**
 * Utilities for handling S3 paths, keys, and URI formatting
 */

/**
 * Normalize an S3 key by removing leading slashes
 */
export function normalizeKey(key: string): string {
  return key.startsWith("/") ? key.substring(1) : key;
}

/**
 * Join path segments into a valid S3 key
 */
export function joinPath(...segments: string[]): string {
  return segments
    .filter((segment) => segment && segment.length > 0)
    .map((segment) => segment.replace(/^\/+|\/+$/g, "")) // Remove leading/trailing slashes
    .join("/")
    .replace(/\/+/g, "/"); // Remove duplicate slashes
}

/**
 * Get the parent prefix of a key or prefix
 */
export function getParentPrefix(path: string): string {
  const normalized = normalizeKey(path);

  // Handle folder case (ends with /)
  if (normalized.endsWith("/")) {
    const withoutTrailingSlash = normalized.slice(0, -1);
    if (!withoutTrailingSlash.includes("/")) {
      return ""; // Top-level folder has no parent
    }
    const parts = withoutTrailingSlash.split("/");
    const parentParts = parts.slice(0, -1);
    return parentParts.join("/") + "/";
  }

  const parts = normalized.split("/");
  if (parts.length <= 1) {
    return "";
  }

  // Remove the last segment
  const parentParts = parts.slice(0, -1);
  return parentParts.join("/") + (parentParts.length > 0 ? "/" : "");
}

/**
 * Get the filename from a key (last segment)
 */
export function getFileName(key: string): string {
  const normalized = normalizeKey(key);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Get the directory name from a key (everything except the filename)
 */
export function getDirName(key: string): string {
  return getParentPrefix(key);
}

/**
 * Check if a key represents a folder (ends with /)
 */
export function isFolder(key: string): boolean {
  return key.endsWith("/");
}

/**
 * Ensure a prefix ends with a slash (for folder operations)
 */
export function ensureTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

/**
 * Remove trailing slash from a prefix (for display purposes)
 */
export function removeTrailingSlash(prefix: string): string {
  return prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
}

/**
 * Create an S3X URI for the filesystem provider
 */
export function createS3xUri(bucket: string, key?: string): string {
  const normalizedKey = key ? normalizeKey(key) : "";
  return `s3x://${bucket}/${normalizedKey}`;
}

/**
 * Parse an S3X URI into bucket and key components
 */
export function parseS3xUri(uri: string): { bucket: string; key: string } {
  const match = uri.match(/^s3x:\/\/([^\/]+)\/(.*)$/);
  if (!match) {
    throw new Error(`Invalid S3X URI: ${uri}`);
  }

  return {
    bucket: match[1],
    key: normalizeKey(match[2]),
  };
}

/**
 * Check if a key is a child of a prefix
 */
export function isChildOf(key: string, prefix: string): boolean {
  if (!prefix) {
    return true; // Everything is a child of root
  }

  const normalizedKey = normalizeKey(key);
  const normalizedPrefix = normalizeKey(prefix);

  return normalizedKey.startsWith(normalizedPrefix);
}

/**
 * Get the relative path of a key from a prefix
 */
export function getRelativePath(key: string, prefix: string): string {
  if (!prefix) {
    return normalizeKey(key);
  }

  const normalizedKey = normalizeKey(key);
  const normalizedPrefix = normalizeKey(prefix);

  if (!normalizedKey.startsWith(normalizedPrefix)) {
    return normalizedKey;
  }

  const relativePath = normalizedKey.substring(normalizedPrefix.length);
  return relativePath.startsWith("/")
    ? relativePath.substring(1)
    : relativePath;
}

/**
 * Split a path into its directory segments
 */
export function getPathSegments(path: string): string[] {
  const normalized = normalizeKey(path);
  return normalized.split("/").filter((segment) => segment.length > 0);
}

/**
 * Get the depth of a path (number of directory levels)
 */
export function getPathDepth(path: string): number {
  return getPathSegments(path).length;
}

/**
 * Check if a path is at the same level as a prefix
 */
export function isSameLevel(path: string, prefix: string): boolean {
  const pathDepth = getPathDepth(path);
  const prefixDepth = getPathDepth(prefix);

  return Math.abs(pathDepth - prefixDepth) <= 1;
}

/**
 * Generate a unique key by appending a suffix if the key already exists
 */
export function generateUniqueKey(
  baseKey: string,
  existingKeys: string[]
): string {
  let counter = 1;
  let uniqueKey = baseKey;

  while (existingKeys.includes(uniqueKey)) {
    const extension = getFileExtension(baseKey);
    const nameWithoutExt = baseKey.substring(0, baseKey.lastIndexOf("."));

    if (extension) {
      uniqueKey = `${nameWithoutExt} (${counter}).${extension}`;
    } else {
      uniqueKey = `${baseKey} (${counter})`;
    }

    counter++;
  }

  return uniqueKey;
}

/**
 * Get the file extension from a key
 */
export function getFileExtension(key: string): string {
  const fileName = getFileName(key);
  const lastDotIndex = fileName.lastIndexOf(".");

  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return "";
  }

  return fileName.substring(lastDotIndex + 1);
}

/**
 * Check if a key represents a text file based on its extension
 */
export function isTextFile(key: string): boolean {
  const textExtensions = [
    "txt",
    "md",
    "json",
    "xml",
    "html",
    "htm",
    "css",
    "js",
    "ts",
    "tsx",
    "jsx",
    "py",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "cs",
    "php",
    "rb",
    "go",
    "rs",
    "yaml",
    "yml",
    "toml",
    "ini",
    "cfg",
    "conf",
    "log",
    "sql",
    "sh",
    "bat",
    "ps1",
    "csv",
    "tsv",
    "svg",
    "dockerfile",
    "gitignore",
    "readme",
  ];

  const extension = getFileExtension(key).toLowerCase();
  return textExtensions.includes(extension);
}

/**
 * Check if a key represents an image file based on its extension
 */
export function isImageFile(key: string): boolean {
  const imageExtensions = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "tiff",
    "tif",
    "webp",
    "svg",
    "ico",
  ];

  const extension = getFileExtension(key).toLowerCase();
  return imageExtensions.includes(extension);
}

/**
 * Check if a key represents a video file based on its extension
 */
export function isVideoFile(key: string): boolean {
  const videoExtensions = [
    "mp4",
    "avi",
    "mov",
    "wmv",
    "flv",
    "webm",
    "mkv",
    "m4v",
    "3gp",
    "ogv",
    "mpeg",
    "mpg",
  ];

  const extension = getFileExtension(key).toLowerCase();
  return videoExtensions.includes(extension);
}

/**
 * Check if a key represents an audio file based on its extension
 */
export function isAudioFile(key: string): boolean {
  const audioExtensions = [
    "mp3",
    "wav",
    "flac",
    "aac",
    "ogg",
    "wma",
    "m4a",
    "opus",
  ];

  const extension = getFileExtension(key).toLowerCase();
  return audioExtensions.includes(extension);
}

/**
 * Validate that a key is safe for S3
 */
export function isValidS3Key(key: string): boolean {
  // S3 key validation rules
  if (!key || key.length === 0 || key.length > 1024) {
    return false;
  }

  // Keys cannot contain certain characters
  const invalidChars = /[\x00-\x1f\x7f]/;
  if (invalidChars.test(key)) {
    return false;
  }

  // Additional restrictions for better compatibility
  if (key.includes("//") || key.startsWith("/") || key.endsWith("/")) {
    // Allow trailing slash for folders, but not leading slash or double slashes
    if (!(key.endsWith("/") && !key.startsWith("/") && !key.includes("//"))) {
      return false;
    }
  }

  return true;
}

/**
 * Sanitize a key to make it valid for S3
 */
export function sanitizeS3Key(key: string): string {
  let sanitized = key
    .replace(/[\x00-\x1f\x7f]/g, "") // Remove control characters
    .replace(/\/+/g, "/") // Replace multiple slashes with single slash
    .replace(/^\/+/, ""); // Remove leading slashes

  // Truncate if too long
  if (sanitized.length > 1024) {
    const extension = getFileExtension(sanitized);
    const maxNameLength = 1024 - (extension ? extension.length + 1 : 0);
    const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf("."));

    if (extension) {
      sanitized = `${nameWithoutExt.substring(0, maxNameLength)}.${extension}`;
    } else {
      sanitized = sanitized.substring(0, 1024);
    }
  }

  return sanitized;
}
