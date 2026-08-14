import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  geminiAdapterContext as adapterContext,
  playwrightGeminiBrowserFixture as fixture,
} from '../test-support/gemini-playwright-browser-fixture.mjs';

test('unexpected health navigation failures preserve diagnostics and provider viewport', async () => {
  for (const failure of [new Error('navigation changed'), 'non-error navigation failure']) {
    const fake = fixture();
    fake.failNavigation(failure);
    await assert.rejects(fake.browser.health(adapterContext), (received) => received === failure);
    assert.ok(fake.calls.includes('close-open'));
    assert.deepEqual(
      fake.artifacts.map(([kind]) => kind),
      ['diagnostic', 'screenshot'],
    );
    assert.match(fake.artifacts[0][2], /navigation/);
  }
});
