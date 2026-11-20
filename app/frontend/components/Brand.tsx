import { uiText } from '../i18n';

export function BrandName() {
  return <span className="brand-name">
    PetCare<sup className="brand-beta" role="img" aria-label={uiText('Бета-версия')}>β</sup>
  </span>;
}

export function Brand() {
  return <><span className="brand-mark" aria-hidden="true" /><BrandName /></>;
}
