import { uiText } from '../../i18n';

export const periods = [
  { months: 1, label: uiText('1 месяц') },
  { months: 3, label: uiText('3 месяца') },
  { months: 6, label: uiText('6 месяцев') },
  { months: 12, label: uiText('12 месяцев') },
] as const;

export type Prices = Record<(typeof periods)[number]['months'], number>;
export const maxPremiumPrice = 2_147_483_647;
