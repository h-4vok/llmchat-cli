import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type CommandRunner = {
  run(command: string, args: string[]): CommandResult;
};

export type PowerShellRunner = {
  runScript(script: string, parameters: string[]): CommandResult;
};

export const nodeCommandRunner: CommandRunner = {
  run(command, args): CommandResult {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  },
};

export function createPowerShellRunner(commandRunner: CommandRunner): PowerShellRunner {
  return {
    runScript(script, parameters): CommandResult {
      const directory = mkdtempSync(join(tmpdir(), 'llmchat-powershell-'));
      const path = join(directory, 'command.ps1');
      try {
        writeFileSync(path, script, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return commandRunner.run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path,
          ...parameters,
        ]);
      } finally {
        unlinkSync(path);
        rmdirSync(directory);
      }
    },
  };
}

export const nodePowerShellRunner = createPowerShellRunner(nodeCommandRunner);
