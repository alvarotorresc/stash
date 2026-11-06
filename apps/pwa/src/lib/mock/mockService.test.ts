import { describe, expect, it, vi } from 'vitest';
import { createMockService } from './mockService';

describe('mock service', () => {
  it('should upload the queue when the connection comes back', async () => {
    const service = createMockService();
    window.dispatchEvent(new Event('offline'));
    expect(service.isOnline()).toBe(false);
    const listener = vi.fn();
    service.subscribe(listener);

    const saved = await service.save('https://example.com/sin-red');
    expect(saved.queued).toBe(true);
    window.dispatchEvent(new Event('online'));

    expect(listener).toHaveBeenCalled();
    const items = await service.listItems();
    expect(items.some((item) => item.queued)).toBe(false);
  });

  it('should return the existing item when the same link is saved twice', async () => {
    const service = createMockService({ online: true });

    const first = await service.save('https://lacocinaordenada.es/organizar-la-despensa');
    const fresh = await service.save('https://example.com/nuevo');

    expect({ id: first.id, already: first.alreadySaved, fresh: fresh.alreadySaved }).toEqual({
      id: 'item-despensa',
      already: true,
      fresh: false,
    });
  });

  it('should reject changes offline and keep search and reads working', async () => {
    const service = createMockService({ online: false });

    await expect(service.setStatus('item-despensa', 'read')).rejects.toThrow('offline');
    expect(
      await service.search({
        query: 'despensa',
        status: 'all',
        source: 'all',
        category: 'all',
        priority: 'all',
      }),
    ).toHaveLength(1);
    expect(await service.getItem('nada')).toBeNull();
  });

  it('should merge a renamed tag that already exists on an item', async () => {
    const service = createMockService({ online: true });

    await service.renameTag('otoño', 'cena');

    expect((await service.getItem('item-calabaza'))?.tags).toEqual(['cena']);
  });

  it('should not duplicate a category with the same name', async () => {
    const service = createMockService({ online: true });

    const category = await service.createCategory('casa');

    expect(category.id).toBe('cat-casa');
    expect(await service.listCategories()).toHaveLength(5);
  });

  it('should wait the configured latency', async () => {
    vi.useFakeTimers();
    const service = createMockService({ online: true, latency: 100 });
    const pending = service.getSession();
    await vi.advanceTimersByTimeAsync(100);

    expect((await pending)?.email).toBe('maria@ejemplo.com');
    vi.useRealTimers();
  });
});
