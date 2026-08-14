import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  geminiAdapterContext as adapterContext,
  playwrightGeminiBrowserFixture as fixture,
} from '../test-support/gemini-playwright-browser-fixture.mjs';
test('real Gemini browser port uses the dedicated profile and secure artifact ports', async () => {
  const fake = fixture();
  const conversation = await fake.browser.open(adapterContext);
  await conversation.persistFailure(new Error('token=private'));
  await conversation.close();
});
test('health validates Gemini, composer, model picker, and send after text entry', async () => {
  const fake = fixture();
  await fake.browser.open(adapterContext);
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'healthy',
    message:
      'Gemini page found. Composer found. Model selector found. Send button found after text entry.',
  });
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'broken',
    message: 'Gemini UI changed: composer selector is missing.',
  });
  assert.match(fake.artifacts.at(-2)[2], /composer selector is missing/);
});
test('health waits for a composer rendered after navigation', async () => {
  const fake = fixture('ready', 2);
  assert.deepEqual(await fake.browser.health(adapterContext), {
    status: 'healthy',
    message:
      'Gemini page found. Composer found. Model selector found. Send button found after text entry.',
  });
});

test('health reports missing model and send controls', async () => {
  assert.equal((await fixture('model-broken').browser.health(adapterContext)).status, 'broken');
  assert.equal((await fixture('send-broken').browser.health(adapterContext)).status, 'broken');
  assert.equal((await fixture('closed').browser.health(adapterContext)).status, 'broken');
});

test('health tolerates artifact failures while preserving original failure', async () => {
  const fake = fixture('broken', 0, { artifactFailure: true, closeFailure: true });
  await assert.rejects(fake.browser.health(adapterContext), /artifact/);
});
test('health succeeds when closing its page fails', async () => {
  const fake = fixture('ready', 0, { closeFailure: true });
  assert.equal((await fake.browser.health(adapterContext)).status, 'healthy');
});
