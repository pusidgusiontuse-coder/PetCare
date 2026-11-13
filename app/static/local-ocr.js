/* Runs entirely on the device. All engine/model downloads are same-origin. */
(() => {
  const ROOT = '/static/ocr/vendor';
  let library;
  function loadLibrary() {
    if (window.Tesseract) return Promise.resolve();
    if (!library) library = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('Не удалось загрузить распознавание. Проверьте интернет и повторите.')); }, 45000);
      script.src = ROOT + '/tesseract.min.js';
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Не удалось загрузить распознавание. Проверьте интернет и повторите.')); };
      document.head.append(script);
    }).catch(error => { library = null; throw error; });
    return library;
  }

  async function prepare(file, rotation = 0) {
    const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      if (!image.width || !image.height || image.width * image.height > 40000000) throw new Error('Фото слишком большое. Выберите изображение до 40 мегапикселей.');
      const edge = Math.max(image.width, image.height);
      const scale = Math.min(2, 2600 / edge); // Preserve small letters without exhausting phone memory.
      const width = Math.round(image.width * scale), height = Math.round(image.height * scale);
      const turned = rotation === 90 || rotation === 270;
      const canvas = document.createElement('canvas');
      canvas.width = turned ? height : width; canvas.height = turned ? width : height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Браузер не поддерживает обработку фото. Попробуйте обновить его.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.save(); context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(rotation * Math.PI / 180); context.drawImage(image, -width / 2, -height / 2, width, height); context.restore();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const histogram = new Uint32Array(256), data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114);
        data[i] = data[i + 1] = data[i + 2] = gray; histogram[gray]++;
      }
      const cutoff = canvas.width * canvas.height * .01;
      let low = 0, high = 255, count = 0;
      while (low < 254 && count + histogram[low] <= cutoff) count += histogram[low++];
      count = 0;
      while (high > low + 1 && count + histogram[high] <= cutoff) count += histogram[high--];
      if (high - low > 30) for (let i = 0; i < data.length; i += 4) {
        const gray = Math.max(0, Math.min(255, Math.round((data[i] - low) * 255 / (high - low))));
        data[i] = data[i + 1] = data[i + 2] = gray;
      }
      context.putImageData(pixels, 0, 0);
      return canvas;
    } finally { image.close(); }
  }

  async function recognize(file, { rotation = 0, progress = () => {} } = {}) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Поддерживаются JPG, PNG и WebP.');
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('Выберите непустое фото размером до 10 МБ.');
    if (!window.WebAssembly || !window.Worker || !window.createImageBitmap) throw new Error('Для распознавания нужен современный Chrome, Safari или Firefox. Обновите браузер.');
    let worker, canvas, timer, expired = false;
    const job = (async () => {
      progress('Подготавливаем фото…');
      try { canvas = await prepare(file, rotation); }
      catch (error) { if (error.name === 'InvalidStateError') throw new Error('Не удалось открыть фото. Выберите другой JPG, PNG или WebP.'); throw error; }
      await loadLibrary();
      progress('Загружаем русский и английский языки. Первый запуск может занять минуту…');
      worker = await Tesseract.createWorker('rus+eng', 1, {
        workerPath: ROOT + '/worker.min.js', corePath: ROOT, langPath: ROOT,
        workerBlobURL: false, gzip: true,
        logger: message => {
          if (message.status === 'recognizing text') progress('Распознаём текст: ' + Math.round(message.progress * 100) + '%');
        },
      });
      if (expired) { await worker.terminate(); throw new Error('Время ожидания истекло.'); }
      await worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
      const { data } = await worker.recognize(canvas);
      const text = data.text.replace(/\r\n?/g, '\n').trim();
      if (!text) throw new Error('Печатный текст не найден. Снимите документ ближе, без бликов, и проверьте поворот фото.');
      return { text, confidence: data.confidence };
    })();
    try {
      return await Promise.race([job, new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error('Распознавание заняло слишком много времени. Попробуйте фото одной страницы меньшего размера.')); }, 150000);
      })]);
    } finally {
      clearTimeout(timer);
      if (worker) await worker.terminate();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  window.PetCareOCR = { recognize, prepare };
})();
