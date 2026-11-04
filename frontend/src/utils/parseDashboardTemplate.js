import { validateScreenTemplate } from '../routes/screenRegistry.js';

export function parseDashboardTemplate(source) {
  const documentSource = new DOMParser().parseFromString(source, 'text/html');
  validateScreenTemplate(documentSource);

  const styles = [...documentSource.head.querySelectorAll('style')]
    .map((style) => style.textContent)
    .join('\n');
  const scripts = [...documentSource.body.querySelectorAll('script')].map((script) => ({
    source: script.getAttribute('src'),
    content: script.textContent
  }));
  documentSource.body.querySelectorAll('script').forEach((script) => script.remove());

  return { markup: documentSource.body.innerHTML, styles, scripts };
}
