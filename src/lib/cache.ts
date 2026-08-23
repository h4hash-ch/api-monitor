export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  put<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export class WorkerCache implements CacheStore {
  /**
   * Cache API storage is intentionally an ephemeral, data-centre-local
   * optimization. Every caller must tolerate a miss or an unavailable cache;
   * Supabase remains the source of truth.
   */
  private readonly cache = caches.open('monitor-statistics-v1');

  async get<T>(key: string): Promise<T | null> {
    const response = await (await this.cache).match(
      new Request(
        `https://cache.internal/${encodeURIComponent(key)}`
      )
    );

    return response
      ? ((await response.json()) as T)
      : null;
  }

  async put<T>(
    key: string,
    value: T,
    ttlSeconds: number
  ): Promise<void> {
    await (await this.cache).put(
      new Request(
        `https://cache.internal/${encodeURIComponent(key)}`
      ),
      new Response(JSON.stringify(value), {
        headers: {
          'Cache-Control': `max-age=${ttlSeconds}`,
          'Content-Type': 'application/json',
        },
      })
    );
  }
}
