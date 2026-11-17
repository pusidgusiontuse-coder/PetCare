import { filePickerMarkup, type UploadKind } from '../lib/filePicker';

export function FilePicker({id, name, kind, title}: {id: string; name: string; kind: UploadKind; title: string}) {
  // The shared picker binds after the shell mounts, as do the other legacy forms.
  return <div className="full" dangerouslySetInnerHTML={{__html: filePickerMarkup(id, name, kind, title)}} />;
}
