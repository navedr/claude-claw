import { mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import https from 'https'
import { createWriteStream } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { TELEGRAM_BOT_TOKEN } from './config.js'

const _dir = path.dirname(fileURLToPath(import.meta.url))
export const UPLOADS_DIR = path.join(path.dirname(_dir), 'workspace', 'uploads')

mkdirSync(UPLOADS_DIR, { recursive: true })

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-')
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    https.get(url, (res) => {
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
  })
}

async function getTelegramFileUrl(fileId: string): Promise<string> {
  const filePath = await new Promise<string>((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString())
          resolve(json.result.file_path as string)
        } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
  return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
}

export async function downloadMedia(fileId: string, originalFilename?: string): Promise<string> {
  const url = await getTelegramFileUrl(fileId)
  const ext = url.split('.').pop() ?? 'bin'
  const baseName = originalFilename ? sanitizeFilename(originalFilename) : `${fileId}.${ext}`
  const dest = path.join(UPLOADS_DIR, `${Date.now()}_${baseName}`)
  await download(url, dest)
  return dest
}

export function buildPhotoMessage(localPath: string, caption?: string): string {
  const parts = [`Photo saved at: ${localPath}`]
  if (caption) parts.push(`Caption: ${caption}`)
  parts.push('Please analyze this image and describe what you see.')
  return parts.join('\n')
}

export function buildDocumentMessage(localPath: string, filename: string, caption?: string): string {
  const parts = [`Document saved at: ${localPath}`, `Filename: ${filename}`]
  if (caption) parts.push(`Caption: ${caption}`)
  parts.push('Please read and summarize this document.')
  return parts.join('\n')
}

export function buildVideoMessage(localPath: string, caption?: string): string {
  const parts = [
    `Video saved at: ${localPath}`,
  ]
  if (caption) parts.push(`Caption: ${caption}`)
  parts.push(
    'Please analyze this video using the gemini-api-dev skill with the GOOGLE_API_KEY from .env.'
  )
  return parts.join('\n')
}

export function cleanupOldUploads(maxAgeMs = 24 * 60 * 60 * 1000): void {
  const now = Date.now()
  try {
    for (const file of readdirSync(UPLOADS_DIR)) {
      const fp = path.join(UPLOADS_DIR, file)
      if (now - statSync(fp).mtimeMs > maxAgeMs) {
        unlinkSync(fp)
      }
    }
  } catch {
    // best effort
  }
}
