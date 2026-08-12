import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeGeminiPrompt } from '../dist/gemini-flow.js';
import { geminiInterventionFixture as fixture } from '../test-support/gemini-intervention-fixture.mjs';

test('post-probe login, captcha, and blocked states wait manually without resending', async () => {
  for (const intervention of ['login', 'login-url', 'captcha', 'blocked']) {
    const fake = fixture(intervention);
    const signals = [];
    let settled = false;
    const execution = fake.conversation
      .submit({ prompt: 'hello' }, (signal) => signals.push(signal))
      .finally(() => (settled = true));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(settled, false, intervention);
    assert.equal(fake.notifications.length, 1, intervention);
    assert.equal(signals[0].kind, 'activity');
    assert.equal(
      fake.calls.some(([kind]) => kind === 'fill'),
      false,
    );
    fake.resolve();
    await execution;

    assert.equal(fake.calls.filter(([kind]) => kind === 'goto').length, 1);
    assert.equal(fake.calls.filter(([kind]) => kind === 'fill').length, 1);
    assert.equal(fake.calls.filter((call) => call.join(':') === 'click:send').length, 1);
    assert.equal(
      fake.calls.some(([kind]) => kind === 'close'),
      false,
    );
  }
});

test('manual intervention cancellation preserves the browser and does not retry', async () => {
  const fake = fixture('captcha');
  const execution = fake.conversation.submit({ prompt: 'hello' }, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  fake.cancel();

  await assert.rejects(execution, /manual Gemini intervention was cancelled/i);
  assert.equal(fake.notifications.length, 1);
  assert.deepEqual(fake.calls, [['goto']]);
});

test('a page closed without intervention evidence cancels without notification', async () => {
  const fake = fixture();
  fake.cancel();

  await assert.rejects(
    fake.conversation.submit({ prompt: 'hello' }, () => {}),
    /manual Gemini intervention was cancelled/i,
  );
  assert.equal(fake.notifications.length, 0);
  assert.deepEqual(fake.calls, [['goto']]);
});

test('repeated manual wait cycles invalidate every prior inactivity deadline', async () => {
  const fake = fixture('blocked');
  const timers = [];
  let settled = false;
  const execution = executeGeminiPrompt(
    fake.conversation,
    { prompt: 'hello' },
    {
      inactivityMs: 10,
      schedule(expire) {
        timers.push(expire);
        return () => {};
      },
    },
  ).finally(() => (settled = true));
  await new Promise((resolve) => setImmediate(resolve));

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const stale = timers.at(-1);
    fake.advance();
    await new Promise((resolve) => setImmediate(resolve));
    stale();
    assert.equal(settled, false);
  }
  fake.resolve();
  assert.deepEqual(await execution, { text: 'response' });
  assert.equal(fake.calls.filter((call) => call.join(':') === 'click:send').length, 1);
});

test('a generation challenge pauses work without duplicate send or notification', async () => {
  const fake = fixture(undefined, 'captcha');
  const signals = [];
  let settled = false;
  const execution = fake.conversation
    .submit({ prompt: 'hello' }, (signal) => signals.push(signal))
    .finally(() => (settled = true));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false);
  assert.equal(fake.notifications.length, 1);
  assert.equal(fake.calls.filter((call) => call.join(':') === 'click:send').length, 1);
  fake.resolve();
  await execution;

  assert.equal(fake.calls.filter((call) => call.join(':') === 'click:send').length, 1);
  assert.deepEqual(
    signals.map(({ kind }) => kind),
    ['activity', 'response'],
  );
});

test('separate navigation and generation challenges notify only once', async () => {
  const fake = fixture('login', 'blocked');
  const execution = fake.conversation.submit({ prompt: 'hello' }, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  fake.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fake.notifications.length, 1);
  assert.equal(fake.calls.filter((call) => call.join(':') === 'click:send').length, 1);
  fake.resolve();
  await execution;
  assert.equal(fake.notifications.length, 1);
});
