import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export function fragmentedCliProcess(mode) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      const text = 'Análisis 🌍';
      const result = { schemaVersion: 1, type: 'result', status: 'success', response: { text } };
      writeFragmented(child.stdout, JSON.stringify(result));
      writeFragmented(child.stderr, text);
      child.emit('close', mode === 'failure' ? 3 : 0);
    });
    return child;
  };
}

function writeFragmented(stream, text) {
  const bytes = Buffer.from(text);
  const split = bytes.indexOf(Buffer.from('á')) + 1;
  stream.write(bytes.subarray(0, split));
  stream.end(bytes.subarray(split));
}
