// Client-side photo resize/compression before embedding as base64 in the
// JSON file. Keeps a tree of a few hundred people at a manageable file size.
const ImageUtils = (() => {
  const MAX_EDGE = 500;
  const JPEG_QUALITY = 0.8;

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function resizeAndCompress(file) {
    const dataUrl = await fileToDataUrl(file);
    const img = await loadImage(dataUrl);
    let { width, height } = img;
    const longestEdge = Math.max(width, height);
    if (longestEdge > MAX_EDGE) {
      const scale = MAX_EDGE / longestEdge;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  return { resizeAndCompress };
})();
