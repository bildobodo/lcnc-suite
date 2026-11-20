import {defineConfig} from '@playwright/test';
import base from './playwright.firefox.config';
export default defineConfig({...base,testMatch:/r415-dialog-walk\.spec\.ts$/,grep:undefined});
