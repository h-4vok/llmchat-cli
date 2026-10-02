export function environmentForCommand(
  command: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const name = command.replace(/.*[\\/]/, '').toLowerCase();
  if (name !== 'powershell.exe') return environment;
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
}
