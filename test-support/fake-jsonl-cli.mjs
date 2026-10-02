const [mode, ...args] = process.argv.slice(2);
const record = { schemaVersion: 1, type: 'result', status: 'success', response: { text: 'ok' } };
const modes = {
  echo() {
    console.log(JSON.stringify({ ...record, args }));
  },
  failure() {
    console.log(
      JSON.stringify({
        ...record,
        status: 'failure',
        error: { code: 'CHAT_FAILED', message: 'Run llmchat auth gemini' },
      }),
    );
    process.exitCode = 1;
  },
  activity() {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        type: 'activity',
        provider: 'demo',
        kind: 'warning',
        message: 'model unavailable',
      }),
    );
    console.log(JSON.stringify(record));
  },
  malformed() {
    console.log('{broken');
  },
  invalid() {
    console.log(JSON.stringify({ ...record, status: 'maybe' }));
  },
  empty() {
    console.error('diagnostic only');
  },
  nonzero() {
    console.log(JSON.stringify(record));
    console.error('child diagnostic');
    process.exitCode = 3;
  },
  version() {
    console.log(JSON.stringify({ ...record, schemaVersion: 2 }));
  },
  wait() {
    setInterval(() => {}, 1000);
  },
};
modes[mode]();
