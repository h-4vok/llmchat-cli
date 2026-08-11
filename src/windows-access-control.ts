import { nodePowerShellRunner, type PowerShellRunner } from './process-boundary.js';

export type StorageAccessControl = {
  secureDirectory(path: string): boolean;
  secureFile(path: string): boolean;
};

const aclScript = [
  "param([Parameter(Mandatory=$true)][string]$Target,[ValidateSet('directory','file')][string]$Kind)",
  "$ErrorActionPreference='Stop'",
  '$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name',
  '$acl=Get-Acl -LiteralPath $Target',
  '$acl.SetAccessRuleProtection($true,$false)',
  'foreach($existing in @($acl.Access)){$acl.RemoveAccessRuleSpecific($existing)}',
  "$inherit=if($Kind -eq 'directory'){'ContainerInherit,ObjectInherit'}else{'None'}",
  "$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl',$inherit,'None','Allow')",
  '$acl.AddAccessRule($rule)',
  "if($Kind -eq 'directory'){[IO.Directory]::SetAccessControl($Target,$acl)}else{[IO.File]::SetAccessControl($Target,$acl)}",
  '$actual=Get-Acl -LiteralPath $Target',
  '$rules=@($actual.Access)',
  "$expected=if($Kind -eq 'directory'){'ContainerInherit, ObjectInherit'}else{'None'}",
  "$ok=$actual.AreAccessRulesProtected -and $rules.Count -eq 1 -and $rules[0].IdentityReference.Value -eq $identity -and $rules[0].AccessControlType -eq 'Allow'",
  "$ok=$ok -and $rules[0].FileSystemRights.ToString().Contains('FullControl') -and $rules[0].InheritanceFlags.ToString() -eq $expected -and $rules[0].PropagationFlags -eq 'None'",
  "if(-not $ok){exit 3};Write-Output 'LLMCHAT_ACL_OK'",
].join(';');

export function createWindowsAccessControl(runner: PowerShellRunner): StorageAccessControl {
  return {
    secureDirectory: (path) => securePath(runner, path, 'directory'),
    secureFile: (path) => securePath(runner, path, 'file'),
  };
}

export const nodeWindowsAccessControl = createWindowsAccessControl(nodePowerShellRunner);

function securePath(runner: PowerShellRunner, path: string, kind: string): boolean {
  const result = runner.runScript(aclScript, [path, kind]);
  return result.status === 0 && result.stdout.includes('LLMCHAT_ACL_OK');
}
