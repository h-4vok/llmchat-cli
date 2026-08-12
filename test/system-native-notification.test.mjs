import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSystemNotificationPort } from '../dist/system-native-notification.js';

const notification = {
  kind: 'authentication-attention',
  provider: 'gemini',
  title: 'Authentication required',
  message: 'gemini needs attention',
};

test('Windows and macOS notifications pass content as process arguments', async (t) => {
  for (const platform of ['win32', 'darwin']) {
    await t.test(platform, async () => {
      const calls = [];
      const port = createSystemNotificationPort(platform, {
        run(command, args) {
          calls.push([command, args]);
          return { status: 0, stdout: '', stderr: '' };
        },
      });
      await port.send(notification);
      assert.equal(calls.length, 1);
      assert.ok(calls[0][1].includes(notification.title));
      assert.ok(calls[0][1].includes(notification.message));
    });
  }
});

test('unsupported systems and failed notification processes fail clearly', async () => {
  assert.throws(() => createSystemNotificationPort('linux', { run() {} }), /Windows and macOS/);
  const port = createSystemNotificationPort('darwin', {
    run: () => ({ status: 1, stdout: '', stderr: 'denied' }),
  });
  await assert.rejects(port.send(notification), /notification failed.*denied/i);
  const empty = createSystemNotificationPort('darwin', {
    run: () => ({ status: 1, stdout: '', stderr: '' }),
  });
  await assert.rejects(empty.send(notification), /exit 1/);
});
