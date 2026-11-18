import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, uploadError } from './filePicker';

describe('upload size and format limits', () => {
  it('accepts a 10 MB document and rejects the next byte', () => {
    expect(uploadError({size: MAX_UPLOAD_BYTES, type: 'application/pdf'}, 'document')).toBe('');
    expect(uploadError({size: MAX_UPLOAD_BYTES + 1, type: 'application/pdf'}, 'document')).toContain('10 МБ');
  });
  it('accepts photos above the old limit, but rejects PDF avatars and empty files', () => {
    expect(uploadError({size: 3 * 1024 * 1024, type: 'image/jpeg'}, 'photo')).toBe('');
    expect(uploadError({size: 500, type: 'application/pdf'}, 'photo')).toContain('JPG');
    expect(uploadError({size: 0, type: 'image/png'}, 'photo')).toContain('пуст');
  });
  it('rejects executable and active image formats before creating a preview', () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/javascript']) {
      expect(uploadError({size: 100, type}, 'document')).not.toBe('');
    }
  });
});
