import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const inspectionScript = `
param(
  [Parameter(Mandatory=$true)][string]$Target,
  [ValidateSet('directory','file')][string]$Kind
)
$ErrorActionPreference='Stop'
$acl=Get-Acl -LiteralPath $Target
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$rules=@($acl.Access)
$rule=$rules[0]
$expected=if($Kind -eq 'directory'){
  [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
}else{
  [Security.AccessControl.InheritanceFlags]::None
}
[ordered]@{
  protected=$acl.AreAccessRulesProtected
  ruleCount=$rules.Count
  identity=$rule.IdentityReference.Value
  currentIdentityOnly=($rules.Count -eq 1 -and $rule.IdentityReference.Value -eq $identity)
  allowOnly=($rules.Count -eq 1 -and $rule.AccessControlType -eq 'Allow')
  fullControl=(($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -eq [Security.AccessControl.FileSystemRights]::FullControl)
  inheritance=$rule.InheritanceFlags.ToString()
  inheritanceCorrect=($rule.InheritanceFlags -eq $expected)
  propagationCorrect=($rule.PropagationFlags -eq 'None')
}|ConvertTo-Json -Compress
`;

export function inspectWindowsAcl(target, kind) {
  const directory = mkdtempSync(join(tmpdir(), 'llmchat-acl-inspection-'));
  const script = join(directory, 'inspect.ps1');
  try {
    writeFileSync(script, inspectionScript, { encoding: 'utf8', mode: 0o600 });
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', script, target, kind],
      { encoding: 'utf8', windowsHide: true },
    );
    if (result.status !== 0) throw new Error(result.stderr || 'ACL inspection failed.');
    return JSON.parse(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
