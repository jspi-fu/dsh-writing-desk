/**
 * Visible-tab cover capture for the stash form.
 *
 * The screenshot is only a convenience: every failure path returns null and
 * the page keeps whatever cover it already had. The canvas step keeps the
 * stored data URL at or below 1 MiB so it fits the Desk capture payload.
 */

const MAX_WIDTH = 1280
const MAX_DATA_URL_LENGTH = 1024 * 1024
const START_QUALITY = 0.72
const MIN_QUALITY = 0.5

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('cover image could not be decoded'))
    image.src = src
  })
}

/**
 * Capture the visible viewport and return a JPEG data URL, or null when the
 * tab cannot be captured or the result cannot be compressed under 1 MiB.
 */
export async function captureVisibleTabCover(): Promise<string | null> {
  let raw: string
  try {
    raw = await chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 72 })
  } catch {
    return null
  }

  try {
    const image = await loadImage(raw)
    if (!image.naturalWidth || !image.naturalHeight) return null

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return null

    let scale = Math.min(1, MAX_WIDTH / image.naturalWidth)
    let quality = START_QUALITY

    for (let attempt = 0; attempt < 10; attempt++) {
      const width = Math.max(1, Math.round(image.naturalWidth * scale))
      const height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.width = width
      canvas.height = height

      // JPEG has no alpha; paint white first so transparent corners stay clean.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(image, 0, 0, width, height)

      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= MAX_DATA_URL_LENGTH) return dataUrl

      if (quality > MIN_QUALITY) {
        quality = Math.max(MIN_QUALITY, quality - 0.1)
      } else {
        scale *= 0.75
      }
    }

    return null
  } catch {
    return null
  }
}