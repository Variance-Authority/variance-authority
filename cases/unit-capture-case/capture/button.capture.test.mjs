// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { capture, writeCapture } from '@variance-authority/unit-test';

test('captures a mounted component for a later browser job', async () => {
  const button = document.createElement('button');
  button.textContent = 'Save';
  button.style.cssText = 'width:120px;height:40px;color:white;background:#185adb';
  document.body.append(button);

  const artifact = await capture(button, {
    subject: 'button/save',
    viewport: {
      width: 320,
      height: 200,
      deviceScaleFactor: 1,
      colorScheme: 'light',
    },
  });
  await writeCapture(process.env.VARIANCE_CAPTURE_DIRECTORY, artifact);

  expect(button.textContent).toBe('Save');
});
