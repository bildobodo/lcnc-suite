import { it, expect } from 'vitest';
const expectedFailure = it.fails; expectedFailure('alias expected failure', () => { expect(1).toBe(2); });
