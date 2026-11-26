import { language } from '../../i18n';
import winterPets from './winter-pets.webp';
import './newYear.css';

const copy = {
  ru: {
    label: 'Декабрь в PetCare',
    greeting: 'С наступающим!',
    message: 'Тёплых праздников вам и вашим питомцам.',
    tips: 'Памятка на праздники',
    checklist: [
      'Уберите мишуру, ленты и провода гирлянд подальше от питомца.',
      'Подготовьте тихое место, где питомец сможет отдохнуть от гостей и шума.',
      'Сохраните привычное расписание кормлений и прогулок.',
    ],
  },
  en: {
    label: 'December in PetCare',
    greeting: 'Happy holidays!',
    message: 'Wishing you and your pets a warm and cosy holiday season.',
    tips: 'Holiday checklist',
    checklist: [
      'Keep tinsel, ribbons and fairy light cords out of your pet’s reach.',
      'Set up a quiet spot where your pet can retreat from visitors and noise.',
      'Keep meals and walks on their usual schedule.',
    ],
  },
} as const;

export function NewYearBanner() {
  const text = copy[language];

  return <aside className="new-year" aria-label={text.label}>
    <div className="new-year-scene">
      <img className="new-year-photo" src={winterPets} alt="" loading="lazy" width={1080} height={720} />
      <div className="new-year-lights" aria-hidden="true"><span>✧</span><span>✦</span><span>✧</span></div>
      <div className="new-year-copy">
        <p className="new-year-label">{text.label}</p>
        <h2>{text.greeting}</h2>
        <p className="new-year-message">{text.message}</p>
      </div>
    </div>
    <details className="new-year-details">
      <summary>{text.tips}</summary>
      <ul>{text.checklist.map(tip => <li key={tip}>{tip}</li>)}</ul>
    </details>
  </aside>;
}
