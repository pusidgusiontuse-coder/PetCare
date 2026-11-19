import { uiText } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { MAX_UPLOAD_BYTES, readUpload, uploadError } from '../lib/filePicker';

export function ProfileGallery() {
  const [photos,setPhotos] = useState<string[]>([]);
  const [changed,setChanged] = useState(false);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  useEffect(() => {
    const populate = (event: Event) => { version.current++; setPhotos((event as CustomEvent<string[]>).detail); setChanged(false); setError(''); };
    window.addEventListener('petcare:profile-photos',populate);
    return () => window.removeEventListener('petcare:profile-photos',populate);
  },[]);
  function update(next: string[]) { setPhotos(next); setChanged(true); window.dispatchEvent(new Event('petcare:gallery-change')); }
  return <section className="profile-gallery full" aria-label={uiText("Фотографии анкеты")}>
    <header><div><h3>{uiText("Фотографии анкеты")}</h3><p>{uiText("До 5 фото · вместе до 10 МБ. Первое фото — обложка.")}</p></div><span>{photos.length}/5</span></header>
    <input type="hidden" name="photos" value={JSON.stringify(photos)} />
    <input type="hidden" name="photos_changed" value={String(changed)} />
    <input ref={input} id="match-photo-input" type="file" multiple accept="image/jpeg,image/png,image/webp" hidden onChange={async event => {
      const files = [...(event.target.files || [])]; event.target.value=''; if (!files.length) return;
      const message = files.map(file=>uploadError(file,'photo')).find(Boolean);
      if (message || photos.length+files.length>5) { setError(message || uiText("В анкете может быть до 5 фото.")); return; }
      const bytes = photos.reduce((sum,photo)=>sum+(photo.split(',')[1]?.length || 0)*3/4,0);
      if(bytes+files.reduce((sum,file)=>sum+file.size,0)>MAX_UPLOAD_BYTES) { setError(uiText("Все фото вместе должны быть не больше 10 МБ.")); return; }
      const token=version.current; setBusy(true); setError('');
      try { const added=await Promise.all(files.map(readUpload)); if(token===version.current) update([...photos,...added]); }
      catch {setError(uiText("Не удалось прочитать фото. Попробуйте ещё раз."));} finally {setBusy(false);}
    }} />
    <div className="gallery-cover">{photos[0] ? <img src={photos[0]} alt={uiText("Обложка анкеты питомца")} /> : <span>{uiText("Добавьте фото питомца")}</span>}</div>
    {photos.length>0 && <div className="gallery-thumbnails">{photos.map((photo,index)=><div key={photo.slice(-40)+index}><button type="button" aria-label={index===0?uiText("Обложка анкеты"):`${uiText("Сделать фото")+" "}${index+1}${" "+uiText("обложкой")}`} onClick={()=>update([photo,...photos.filter((_,i)=>i!==index)])}><img src={photo} alt={`${uiText("Фото")+" "}${index+1}`} /></button><button type="button" className="gallery-remove" aria-label={`${uiText("Удалить фото")+" "}${index+1}`} onClick={()=>update(photos.filter((_,i)=>i!==index))}>×</button></div>)}</div>}
    <button type="button" className="btn gallery-add" data-upload-choose disabled={busy || photos.length===5} onClick={()=>input.current?.click()}>{busy?uiText("Загружаем…"):photos.length?uiText("Добавить фотографии"):uiText("Выбрать фотографии")}</button>
    <p role="status" className="upload-error">{error}</p>
  </section>;
}
