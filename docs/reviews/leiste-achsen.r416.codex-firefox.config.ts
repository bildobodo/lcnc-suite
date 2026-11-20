import {defineConfig} from '@playwright/test';
import base from './playwright.firefox.config';
export default defineConfig({...base,testMatch:/r416-codex\.spec\.ts$/,grep:undefined});
