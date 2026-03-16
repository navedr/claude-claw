import { readFileSync, renameSync } from 'fs'
import https from 'https'
import path from 'path'
import { GROQ_API_KEY } from './config.js'

export function voiceCapabilities(): { stt: boolean; tts: boolean } {
  return {
    stt: Boolean(GROQ_API_KEY),
    tts: false,
  }
}

export async function transcribeAudio(filePath: string): Promise<string> {
  // Groq doesn't accept .oga — rename to .ogg (same format)
  let targetPath = filePath
  if (filePath.endsWith('.oga')) {
    targetPath = filePath.replace(/\.oga$/, '.ogg')
    renameSync(filePath, targetPath)
  }

  const fileBuffer = readFileSync(targetPath)
  const filename = path.basename(targetPath)
  const boundary = `----FormBoundary${Date.now().toString(16)}`

  const bodyParts: Buffer[] = []
  bodyParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-large-v3\r\n`
  ))
  bodyParts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: audio/ogg\r\n\r\n`
  ))
  bodyParts.push(fileBuffer)
  bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`))

  const body = Buffer.concat(bodyParts)

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString())
          if (json.text) resolve(json.text as string)
          else reject(new Error(`Groq error: ${JSON.stringify(json)}`))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
