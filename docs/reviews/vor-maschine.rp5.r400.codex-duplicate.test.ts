import { it, expect } from 'vitest';
it('same title', () => expect(1).toBe(1));
it.fails('same title', () => expect(1).toBe(2));
