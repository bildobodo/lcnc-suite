import { it, expect } from 'vitest';
it.fails('plain expected failure', () => { expect(1).toBe(2); });
