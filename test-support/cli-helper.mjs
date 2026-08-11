import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cli = join(process.cwd(), 'test-support', 'injected-cli.mjs');
const productionCli = join(process.cwd(), 'dist', 'cli.js');

export function run(configHome, ...args) {
  return spawn(cli, configHome, args);
}

export function runProduction(configHome, ...args) {
  return spawn(productionCli, configHome, args);
}

function spawn(entrypoint, configHome, args) {
  const options = typeof args[0] === 'object' ? args.shift() : {};
  return spawnSync(process.execPath, [entrypoint, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: configHome,
      USERPROFILE: configHome,
      LOCALAPPDATA: configHome,
      XDG_CONFIG_HOME: join(configHome, '.config'),
      ...options.env,
    },
  });
}

export function configFile(configHome) {
  const relative =
    process.platform === 'win32'
      ? ['llmchat', 'config.json']
      : process.platform === 'darwin'
        ? ['Library', 'Application Support', 'llmchat', 'config.json']
        : ['.config', 'llmchat', 'config.json'];
  return join(configHome, ...relative);
}
