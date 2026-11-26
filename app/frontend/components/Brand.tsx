import { uiText } from '../i18n';

export function BrandName() {
  return <span className="brand-name">
    PetCare<sup className="brand-beta" role="img" aria-label={uiText('Бета-версия')}>β</sup>
  </span>;
}

export function BrandMark() {
  return <span className="brand-emblem" aria-hidden="true"><span className="brand-mark" /></span>;
}

export function Brand() {
  return <><BrandMark /><BrandName /></>;
}
