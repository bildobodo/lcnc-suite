import {defineConfig} from '@playwright/test';
import base from './playwright.firefox.config';
export default defineConfig({...base,testMatch:/r414-codex\.spec\.ts$/,grep:undefined});
