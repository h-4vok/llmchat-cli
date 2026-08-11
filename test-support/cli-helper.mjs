import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cli = join(process.cwd(), 'dist', 'cli.js');

export function run(configHome, ...args) {
  const options = typeof args[0] === 'object' ? args.shift() : {};
  return spawnSync(process.execPath, [cli, ...args], {
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
