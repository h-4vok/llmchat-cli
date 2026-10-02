import { adminFormat } from './admin-output.js';

export function adminBrowserArguments(args: string[]) {
  const parsed = adminFormat(args);
  return {
    ...parsed,
    args: parsed.args.filter((argument) => argument !== '--headless'),
    headless: parsed.args.includes('--headless'),
  };
}
