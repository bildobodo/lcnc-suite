// R213: executable completeness checks for the promised raw-control inventory.
import {it,expect} from 'vitest';
import {scanControls} from './controlScan';
it('counts a raw click without modifiers (positive control)',()=>{
 expect(scanControls('Example.vue','<template>\n<div @click="act">act</div>\n</template>')).toHaveLength(1);
});
it('counts a raw click with .self — used by DialogFrame.vue',()=>{
 expect(scanControls('Example.vue','<template>\n<div @click.self="act">act</div>\n</template>')).toHaveLength(1);
});
it('counts pointerdown with .prevent',()=>{
 expect(scanControls('Example.vue','<template>\n<div @pointerdown.prevent="act">act</div>\n</template>')).toHaveLength(1);
});
