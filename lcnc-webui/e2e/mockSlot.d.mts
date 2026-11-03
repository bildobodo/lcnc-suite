// Types of mockSlot.mjs (plain JS so pytest can import it with node alone).
export declare const MOCK_BASE_PORT: number;
export declare const MOCK_MAX_SLOTS: number;
export declare const UNBOUND: string;
export declare function slotOf(index: string | undefined): number | null;
export declare function portOf(slot: number): number;
export declare function mockUrl(index: string | undefined): string;
