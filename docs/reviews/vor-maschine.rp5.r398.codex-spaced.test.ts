import { it, expect } from 'vitest';
it.fails ('spaced expected failure', () => { expect(1).toBe(2); });
