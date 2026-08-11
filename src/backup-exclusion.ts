import { nodeCommandRunner, type CommandRunner } from './process-boundary.js';
import { posix } from 'node:path';

export type BackupExclusion = {
  excludeAndVerify(root: string, platform: NodeJS.Platform): boolean;
};

type BackupStrategy = (root: string, runner: CommandRunner) => boolean;

const strategies: Partial<Record<NodeJS.Platform, BackupStrategy>> = {
  darwin: excludeFromTimeMachine,
};

export function createPlatformBackupExclusion(runner: CommandRunner): BackupExclusion {
  return {
    excludeAndVerify(root, platform): boolean {
      const strategy = strategies[platform];
      if (!strategy) {
        throw new Error(`No secure backup exclusion mechanism for platform "${platform}".`);
      }
      return strategy(root, runner);
    },
  };
}

export const nodeBackupExclusion = createPlatformBackupExclusion(nodeCommandRunner);

function excludeFromTimeMachine(root: string, runner: CommandRunner): boolean {
  const canonicalRoot = posix.resolve(root);
  const applied = runner.run('tmutil', ['addexclusion', canonicalRoot]);
  if (applied.status !== 0) return false;
  const verified = runner.run('tmutil', ['isexcluded', canonicalRoot]);
  return (
    verified.status === 0 &&
    verified.stdout.split(/\r?\n/).some((line) => isExactExcludedLine(line, canonicalRoot))
  );
}

function isExactExcludedLine(line: string, root: string): boolean {
  const match = /^\[Excluded\]\s+(.+)$/.exec(line);
  return match !== null && posix.resolve(match[1].trim()) === root;
}
