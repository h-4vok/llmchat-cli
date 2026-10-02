import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geminiInterventionFixture } from '../test-support/gemini-intervention-fixture.mjs';

for (const intervention of ['login', 'login-url', 'captcha', 'blocked']) {
  test(`hidden ${intervention} returns an actionable error before sending`, async () => {
    const fake = geminiInterventionFixture(intervention, undefined, true);
    const outcome = fake.conversation.submit({ prompt: 'hello' }, () => {}).catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    fake.resolve();
    const result = await outcome;
    assert.match(result?.message ?? '', /hidden browser.*headless: false/i);
    assert.equal(
      fake.calls.some(([kind]) => kind === 'fill'),
      false,
    );
    assert.equal(fake.notifications.length, 0);
  });
}

test('a challenge after sending fails hidden consultation without resending', async () => {
  const fake = geminiInterventionFixture(undefined, 'captcha', true);
  const outcome = fake.conversation.submit({ prompt: 'hello' }, () => {}).catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  fake.resolve();
  const result = await outcome;
  assert.match(result?.message ?? '', /captcha.*hidden browser/i);
  assert.equal(fake.calls.filter((call) => call.join(':') === 'click:send').length, 1);
  assert.equal(fake.notifications.length, 0);
});
