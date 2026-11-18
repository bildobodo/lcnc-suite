import { it, expect } from 'vitest';
it.fails.each([1])('each expected failure %s', n => { expect(n).toBe(2); });
