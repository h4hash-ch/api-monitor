export async function boundedMap<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (cursor < items.length) {
          const item = items[cursor++];
          await task(item);
        }
      }
    )
  );
}