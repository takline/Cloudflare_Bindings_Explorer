import { CacheEntry, S3Object, S3Prefix } from "../types";

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

export class S3Cache {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;

  constructor(ttl: number = DEFAULT_TTL) {
    this.ttl = ttl;
  }

  private getCacheKey(bucket: string, prefix?: string): string {
    return `${bucket}:${prefix || ""}`;
  }

  get(bucket: string, prefix?: string): CacheEntry | null {
    const key = this.getCacheKey(bucket, prefix);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.lastFetched > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  set(
    bucket: string,
    objects: S3Object[],
    prefixes: S3Prefix[],
    isTruncated: boolean,
    continuationToken?: string,
    prefix?: string
  ): void {
    const key = this.getCacheKey(bucket, prefix);

    this.cache.set(key, {
      objects: [...objects],
      prefixes: [...prefixes],
      lastFetched: Date.now(),
      isTruncated,
      continuationToken,
    });
  }

  invalidate(bucket: string, prefix?: string): void {
    if (prefix) {
      // Invalidate specific prefix
      const key = this.getCacheKey(bucket, prefix);
      this.cache.delete(key);

      // Also invalidate parent prefixes that might contain this prefix
      const prefixPath = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
      const parentParts = prefixPath.split("/");

      for (let i = parentParts.length - 1; i >= 0; i--) {
        const parentPrefix = parentParts.slice(0, i).join("/");
        const parentKey = this.getCacheKey(bucket, parentPrefix || undefined);
        this.cache.delete(parentKey);
      }
    } else {
      // Invalidate all entries for this bucket
      const bucketPrefix = `${bucket}:`;
      for (const key of this.cache.keys()) {
        if (key.startsWith(bucketPrefix)) {
          this.cache.delete(key);
        }
      }
    }
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  // Append more objects to an existing cache entry (for pagination)
  append(
    bucket: string,
    objects: S3Object[],
    prefixes: S3Prefix[],
    isTruncated: boolean,
    continuationToken?: string,
    prefix?: string
  ): void {
    const key = this.getCacheKey(bucket, prefix);
    const existing = this.cache.get(key);

    if (existing) {
      // Merge with existing entry
      const allObjects = [...existing.objects, ...objects];
      const allPrefixes = [...existing.prefixes, ...prefixes];

      // Remove duplicates based on key/prefix
      const uniqueObjects = allObjects.filter(
        (obj, index, arr) => arr.findIndex((o) => o.key === obj.key) === index
      );
      const uniquePrefixes = allPrefixes.filter(
        (pref, index, arr) =>
          arr.findIndex((p) => p.prefix === pref.prefix) === index
      );

      this.cache.set(key, {
        objects: uniqueObjects,
        prefixes: uniquePrefixes,
        lastFetched: Date.now(),
        isTruncated,
        continuationToken,
      });
    } else {
      // Create new entry
      this.set(
        bucket,
        objects,
        prefixes,
        isTruncated,
        continuationToken,
        prefix
      );
    }
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastFetched > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  // Filter cached objects by a search term
  searchInCache(
    bucket: string,
    searchTerm: string,
    prefix?: string
  ): S3Object[] {
    const entry = this.get(bucket, prefix);
    if (!entry) {
      return [];
    }

    const lowerSearchTerm = searchTerm.toLowerCase();
    return entry.objects.filter((obj) =>
      obj.key.toLowerCase().includes(lowerSearchTerm)
    );
  }

  // Get all cached objects for a bucket (useful for global search)
  getAllCachedObjects(bucket: string): S3Object[] {
    const bucketPrefix = `${bucket}:`;
    const allObjects: S3Object[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(bucketPrefix)) {
        allObjects.push(...entry.objects);
      }
    }

    // Remove duplicates
    return allObjects.filter(
      (obj, index, arr) => arr.findIndex((o) => o.key === obj.key) === index
    );
  }

  // Get cache statistics
  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Global cache instance
export const s3Cache = new S3Cache();
