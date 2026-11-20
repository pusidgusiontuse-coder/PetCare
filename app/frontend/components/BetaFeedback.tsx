import { uiText } from '../i18n';

export function openBetaFeedback() {
  document.querySelector<HTMLDialogElement>('#beta-feedback-dialog')?.showModal();
}

export function BetaFeedbackButton() {
  return <button className="btn beta-feedback-button" type="button" aria-haspopup="dialog" aria-controls="beta-feedback-dialog"
    onClick={openBetaFeedback}>
    {uiText('Оставить отзыв')}
  </button>;
}

export function BetaFeedbackDialog() {
  return <dialog id="beta-feedback-dialog" aria-labelledby="beta-feedback-title">
    <div>
      <form method="dialog">
        <button className="modal-close" type="submit" aria-label={uiText('Закрыть')} />
      </form>
      <p className="beta-feedback-team">{uiText('Команда поддержки')}</p>
      <h2 id="beta-feedback-title">{uiText('PetCare в бета-тесте')}</h2>
      <p>{uiText('Расскажите, как вам PetCare. Мы читаем отзывы в Telegram.')}</p>
      <ul>
        <li>{uiText('Если нашли ошибку, напишите, в каком разделе она произошла и что вы делали перед этим.')}</li>
        <li>{uiText('Расскажите, что вам понравилось и чего не хватает.')}</li>
      </ul>
      <p className="beta-feedback-reward">{uiText('За отзыв, который поможет исправить ошибку или улучшить PetCare, мы можем подарить временный доступ к Premium. Срок зависит от того, насколько отзыв помог проекту.')}</p>
      <a className="btn primary beta-feedback-contact" href="https://t.me/Pet_Care_support" target="_blank" rel="noopener noreferrer">
        {uiText('Написать в Telegram')} <span>@Pet_Care_support</span>
      </a>
    </div>
  </dialog>;
}
