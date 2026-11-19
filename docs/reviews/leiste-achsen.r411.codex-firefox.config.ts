import {defineConfig} from '@playwright/test';
import base from './playwright.firefox.config';
export default defineConfig({...base, testMatch:/r411-codex\.spec\.ts$/,grep:undefined});
