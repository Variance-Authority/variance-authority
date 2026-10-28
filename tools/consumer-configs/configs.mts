import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import type { RuleSetRule } from '@rspack/core';
import { withTestSelection } from '@variance-authority/playwright-test';
import { testSelectionRule } from '@variance-authority/sense/journal';

const config: PlaywrightTestConfig<{ account: string }> = {
  projects: [{ name: 'chromium', use: { account: 'example' } }],
};
const recorded: PlaywrightTestConfig<{ account: string }> = withTestSelection(config);
defineConfig(recorded);
const custom = withTestSelection({ testDir: './test', account: 'example' });
const account: string = custom.account;
void account;
const rules: RuleSetRule[] = [testSelectionRule()];
void rules;
