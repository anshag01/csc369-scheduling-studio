import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const reportName = process.env.MLFQ_AUDIT_REPORT ?? 'mlfq-audit';

export default defineConfig({
  ...base,
  testMatch: '**/*.spec.ts',
  outputDir: `test-results/${reportName}`,
  workers: 2,
  reporter: [['list'], ['html', {open:'never',outputFolder:`playwright-report/${reportName}`}], ['json',{outputFile:`test-results/${reportName}.json`}]],
  use: {...base.use,baseURL:'http://localhost:4174'},
  webServer: {
    command:'npm run build:vercel && npx next start -p 4174',
    url:'http://localhost:4174',reuseExistingServer:false,timeout:120000,
  },
});
