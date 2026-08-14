import assert from 'node:assert/strict';

export const browserSessionRequest = {
  provider: 'gemini',
  profileDirectory: 'C:\\llmchat\\profiles\\gemini',
};

export function createBrowserSessionPorts(sessionStatus, observations = []) {
  const calls = [];
  let closeCalls = 0;
  const loginBrowser = {
    async *observeSession() {
      for (const observation of observations) {
        assert.equal(closeCalls, 0);
        yield await observation;
      }
    },
    async close() {
      closeCalls += 1;
      calls.push('close-login-browser');
    },
  };
  return {
    calls,
    closeCalls: () => closeCalls,
    browser: {
      async checkSession(received) {
        calls.push(['check-session', received]);
        return sessionStatus;
      },
      async openLoginBrowser(received) {
        calls.push(['open-login-browser', received]);
        return loginBrowser;
      },
    },
    notifications: {
      async send(notification) {
        calls.push(['notify', notification]);
      },
    },
  };
}
