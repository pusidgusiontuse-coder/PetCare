import { language } from '../../i18n';
import { chooseNewYearMode, newYearModes, useNewYearAppearance } from './season';

const labels = {
  ru: { title: 'Новогодний режим', off: 'Выключен', medium: 'Средний', max: 'Максимальный' },
  en: { title: 'Holiday mode', off: 'Off', medium: 'Medium', max: 'Maximum' },
};

export function NewYearPicker() {
  const { active, mode } = useNewYearAppearance();
  if (!active) return null;
  const text = labels[language];

  return <fieldset className="new-year-picker">
    <legend>{text.title}</legend>
    <div className="new-year-options">
      {newYearModes.map((value, index) => <label key={value}>
        <input type="radio" name="new-year-mode" value={value} checked={mode === value}
          onChange={() => chooseNewYearMode(value)} />
        <span><i aria-hidden="true">{['◯', '✦', '✦✧'][index]}</i>{text[value]}</span>
      </label>)}
    </div>
  </fieldset>;
}
