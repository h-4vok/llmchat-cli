import type { BrowserContext, Page } from 'playwright';

export async function initializeBrowserContext(
  context: BrowserContext,
  url: string,
): Promise<Page> {
  try {
    const page = await preparePage(context);
    await page.goto(url);
    return page;
  } catch (failure) {
    await context.close().catch(() => undefined);
    throw failure;
  }
}

async function preparePage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  const page = pages[0] ?? (await context.newPage());
  await Promise.all(pages.slice(1).map((extra) => extra.close().catch(() => undefined)));
  return page;
}
