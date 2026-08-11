export default {
  mutate: ['src/**/*.ts'],
  testRunner: 'command',
  commandRunner: {
    command: 'npm run test:compiled',
  },
  buildCommand: 'npm run build',
  concurrency: 2,
  coverageAnalysis: 'off',
  reporters: ['clear-text', 'json'],
  timeoutMS: 30000,
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
};
