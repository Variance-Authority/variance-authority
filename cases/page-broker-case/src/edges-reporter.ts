// After the run: which of the shop's declared edges the tests walked, and which none did.
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import type { Step } from './broker/journal.js';
import { edges, walked } from './broker/journal.js';
import { Billing, Product } from './shop.js';

export default class EdgesReporter implements Reporter {
  private readonly journals: Step[][] = [];

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name === 'journal' && attachment.body) this.journals.push(JSON.parse(attachment.body.toString()));
    }
  }

  onEnd(): void {
    const declared = edges([Billing, Product]);
    const { walked: counts, unwalked, raw } = walked(declared, this.journals);
    const lines = declared.map((edge) => `  ${String(counts[edge] ?? 0).padStart(4)}  ${edge}`);
    console.log(`\nedges walked: ${declared.length - unwalked.length} of ${declared.length}; ${raw} step(s) around the broker\n${lines.join('\n')}`);
  }
}
