let preference;
try { preference = localStorage.getItem('petcare.language'); } catch {}
const preferred = (navigator.languages?.length ? navigator.languages : [navigator.language])
  .map(locale => locale.toLowerCase().split(/[-_]/)[0])
  .find(language => language === 'ru' || language === 'en');
const language = preference === 'ru' || preference === 'en' ? preference : preferred ?? 'en';
document.documentElement.lang = language;
document.querySelectorAll('section').forEach(section => { section.hidden = section.lang !== language; });
