import { screens } from '../pages/index.js';

export function validateScreenTemplate(documentSource) {
  const missingScreens = screens.filter((screen) => !documentSource.getElementById(screen.id));
  if (missingScreens.length) {
    throw new Error(`O dashboard não contém estas telas: ${missingScreens.map((screen) => screen.label).join(', ')}.`);
  }
}
