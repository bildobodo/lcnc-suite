import {defineConfig} from '@playwright/test';
import base from './playwright.firefox.config';
export default defineConfig({...base,testMatch:/r414-native-tab\.spec\.ts$/,grep:undefined});
