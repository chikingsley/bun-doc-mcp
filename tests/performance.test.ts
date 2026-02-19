import { expect, test, describe } from 'bun:test';
import { SimpleCache } from '../src/cache';

describe('Performance & Optimization', () => {
  test('Cache Hit Ratio & Speed', async () => {
    const cache = new SimpleCache<string[]>(5000);
    const key = 'test-query';
    const val = ['result1', 'result2'];

    cache.set(key, val);

    const start2 = performance.now();
    const hit = cache.get(key);
    const end2 = performance.now();

    expect(hit).toEqual(val);
    // Cache access should be near instantaneous (< 0.1ms)
    expect(end2 - start2).toBeLessThan(1);
    console.log(`Cache hit time: ${(end2 - start2).toFixed(4)}ms`);
  });

  test('Cache TTL Expiry', async () => {
    const cache = new SimpleCache<string>(10); // 10ms TTL
    cache.set('expire', 'me');
    expect(cache.get('expire')).toBe('me');

    await new Promise(r => setTimeout(r, 20));
    expect(cache.get('expire')).toBeUndefined();
  });
});
