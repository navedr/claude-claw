import { Bot, Context, InputFile } from 'grammy'
import { TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_ID, MAX_MESSAGE_LENGTH, TYPING_REFRESH_MS } from './config.js'
import { getSession, setSession, clearSession, getMemoriesForDisplay, createJob, completeJob, createAgentTask, completeAgentTask, logUsage } from './db.js'
import { runAgent } from './agent.js'
import { buildMemoryContext, saveConversationTurn } from './memory.js'
import { transcribeAudio, voiceCapabilities } from './voice.js'
import { downloadMedia, buildPhotoMessage, buildDocumentMessage } from './media.js'
import { logger } from './logger.js'
import { randomUUID } from 'crypto'

export function formatForTelegram(text: string): string {
  // Protect code blocks first
  const codeBlocks: string[] = []
  let protected_text = text.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codeBlocks.push(match) - 1
    return `\x00CODE${idx}\x00`
  })

  // Protect inline code
  const inlineCodes: string[] = []
  protected_text = protected_text.replace(/`[^`]+`/g, (match) => {
    const idx = inlineCodes.push(match) - 1
    return `\x00INLINE${idx}\x00`
  })

  // Escape &, <, > in remaining text (will be re-introduced properly)
  protected_text = protected_text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Headings
  protected_text = protected_text.replace(/^#{1,6} (.+)$/gm, '<b>$1</b>')

  // Bold: **text** or __text__
  protected_text = protected_text.replace(/[*][*]([^*]+)[*][*]/g, '<b>$1</b>')
  protected_text = protected_text.replace(/__([^_]+)__/g, '<b>$1</b>')

  // Italic: *text* or _text_
  protected_text = protected_text.replace(/(?<![*])[*]([^*]+)[*](?![*])/g, '<i>$1</i>')
  protected_text = protected_text.replace(/(?<!_)_([^_]+)_(?!_)/g, '<i>$1</i>')

  // Strikethrough
  protected_text = protected_text.replace(/~~([^~]+)~~/g, '<s>$1</s>')

  // Links
  protected_text = protected_text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Checkboxes
  protected_text = protected_text.replace(/- \[ \] /g, '☐ ')
  protected_text = protected_text.replace(/- \[x\] /gi, '☑ ')

  // Strip horizontal rules and bold separators
  protected_text = protected_text.replace(/^---+$/gm, '')
  protected_text = protected_text.replace(/^[*]{3,}$/gm, '')

  // Restore inline code
  protected_text = protected_text.replace(/\x00INLINE(\d+)\x00/g, (_, i) => {
    const code = inlineCodes[parseInt(i)].slice(1, -1)
    return `<code>${code}</code>`
  })

  // Restore code blocks
  protected_text = protected_text.replace(/\x00CODE(\d+)\x00/g, (_, i) => {
    const block = codeBlocks[parseInt(i)]
    const match = block.match(/```([^\n]*)\n?([\s\S]*?)```/)
    if (match) {
      const lang = match[1].trim()
      const code = match[2]
      return lang ? `<pre><code class="language-${lang}">${code}</code></pre>` : `<pre>${code}</pre>`
    }
    return `<pre>${block}</pre>`
  })

  return protected_text.trim()
}

export function splitMessage(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }
    let cutAt = remaining.lastIndexOf('\n', limit)
    if (cutAt <= 0) cutAt = limit
    chunks.push(remaining.slice(0, cutAt))
    remaining = remaining.slice(cutAt).trimStart()
  }
  return chunks
}

export function isAuthorised(chatId: number | string): boolean {
  if (!ALLOWED_CHAT_ID) return true // first-run mode
  return String(chatId) === String(ALLOWED_CHAT_ID)
}

const voiceEnabledChats = new Set<string>()

async function handleMessage(
  ctx: Context,
  rawText: string,
  chatId: string,
  forceVoiceReply = false
): Promise<void> {
  if (!isAuthorised(chatId)) {
    await ctx.reply('Unauthorized.')
    return
  }

  const correlationId = randomUUID()
  createJob(correlationId, chatId, 'message', rawText)
  const startTime = Date.now()

  // Build memory context
  const memCtx = await buildMemoryContext(chatId, rawText)
  const message = memCtx ? `${memCtx}\n\n${rawText}` : rawText

  // Get session
  const sessionId = getSession(chatId) ?? undefined

  // Typing indicator
  let typingActive = true
  const sendTyping = async () => {
    if (typingActive) {
      await ctx.replyWithChatAction('typing').catch(() => {})
    }
  }
  await sendTyping()
  const typingInterval = setInterval(sendTyping, TYPING_REFRESH_MS)

  try {
    const { text, newSessionId } = await runAgent(
      message,
      sessionId,
      () => { sendTyping().catch(() => {}) },
      (desc) => {
        createAgentTask(correlationId, desc)
        logger.info({ desc }, 'Sub-agent task started')
      },
      (usage) => {
        logUsage(correlationId, 'claude', 'input_tokens', usage.input_tokens)
        logUsage(correlationId, 'claude', 'output_tokens', usage.output_tokens)
        if (usage.cache_read_input_tokens) {
          logUsage(correlationId, 'claude', 'cache_tokens', usage.cache_read_input_tokens)
        }
      }
    )

    typingActive = false
    clearInterval(typingInterval)

    if (newSessionId) setSession(chatId, newSessionId)

    const response = text ?? '(no response)'
    completeJob(correlationId, response, Date.now() - startTime, 'done')
    await saveConversationTurn(chatId, rawText, response)

    const formatted = formatForTelegram(response)
    const chunks = splitMessage(formatted)
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: 'HTML' })
    }
  } catch (err) {
    typingActive = false
    clearInterval(typingInterval)
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error({ err }, 'runAgent failed')
    completeJob(correlationId, `ERROR: ${errMsg}`, Date.now() - startTime, 'failed')
    await ctx.reply(`❌ Error: ${errMsg}`)
  }
}

export function createBot(): Bot {
  const bot = new Bot(TELEGRAM_BOT_TOKEN)

  bot.command('start', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    await ctx.reply(
      'ClaudeClaw is running. Send me a message and I\'ll pass it to Claude Code on your machine.\n\n' +
      'Commands:\n/chatid — show your chat ID\n/newchat — start a fresh session\n/memory — show recent memories\n/voice — toggle voice replies\n/forget — alias for /newchat'
    )
  })

  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Your chat ID: ${ctx.chat?.id}`)
  })

  bot.command('newchat', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    clearSession(chatId)
    await ctx.reply('Session cleared. Starting fresh.')
  })

  bot.command('forget', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    clearSession(chatId)
    await ctx.reply('Session cleared.')
  })

  bot.command('memory', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    const memories = getMemoriesForDisplay(chatId, 10)
    if (memories.length === 0) {
      await ctx.reply('No memories stored yet.')
      return
    }
    const lines = memories.map(m => `[${m.sector}] ${m.content.slice(0, 80)}`).join('\n\n')
    await ctx.reply(`Recent memories:\n\n${lines}`)
  })

  bot.command('voice', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    const { tts } = voiceCapabilities()
    if (!tts) {
      await ctx.reply('TTS is not configured. Voice replies require ElevenLabs API key.')
      return
    }
    if (voiceEnabledChats.has(chatId)) {
      voiceEnabledChats.delete(chatId)
      await ctx.reply('Voice replies disabled.')
    } else {
      voiceEnabledChats.add(chatId)
      await ctx.reply('Voice replies enabled.')
    }
  })

  bot.command('status', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    const { formatStatusText } = await import('./dashboard.js')
    await ctx.reply(formatStatusText())
  })

  // Schedule management via bot
  bot.command('schedule', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    const { listScheduledTasks } = await import('./db.js')
    const tasks = listScheduledTasks()
    if (tasks.length === 0) {
      await ctx.reply(
        'No scheduled tasks.\n\nCreate one from the CLI:\n' +
        `node dist/schedule-cli.js create "Your prompt" "0 9 * * *" ${chatId}`
      )
      return
    }
    const lines = tasks.map(t =>
      `[${t.id}] ${t.status} — ${t.schedule}\n  ${t.prompt.slice(0, 60)}`
    ).join('\n\n')
    await ctx.reply(`Scheduled tasks:\n\n${lines}`)
  })

  // Text messages
  bot.on('message:text', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    const text = ctx.message.text
    if (!text || text.startsWith('/')) return
    await handleMessage(ctx, text, chatId)
  })

  // Voice messages
  bot.on('message:voice', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    const { stt } = voiceCapabilities()
    if (!stt) {
      await ctx.reply('Voice transcription is not configured (no GROQ_API_KEY).')
      return
    }
    try {
      await ctx.replyWithChatAction('typing')
      const fileId = ctx.message.voice.file_id
      const localPath = await downloadMedia(fileId, `voice_${fileId}.oga`)
      const transcript = await transcribeAudio(localPath)
      await handleMessage(ctx, `[Voice transcribed]: ${transcript}`, chatId, true)
    } catch (err) {
      logger.error({ err }, 'Voice transcription failed')
      await ctx.reply(`❌ Voice transcription failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // Photo messages
  bot.on('message:photo', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    try {
      await ctx.replyWithChatAction('typing')
      const photo = ctx.message.photo[ctx.message.photo.length - 1]
      const localPath = await downloadMedia(photo.file_id, `photo_${photo.file_id}.jpg`)
      const caption = ctx.message.caption
      const prompt = buildPhotoMessage(localPath, caption)
      await handleMessage(ctx, prompt, chatId)
    } catch (err) {
      logger.error({ err }, 'Photo handling failed')
      await ctx.reply(`❌ Failed to process photo: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // Document messages
  bot.on('message:document', async (ctx) => {
    const chatId = String(ctx.chat?.id ?? '')
    if (!isAuthorised(chatId)) return
    try {
      await ctx.replyWithChatAction('typing')
      const doc = ctx.message.document
      const localPath = await downloadMedia(doc.file_id, doc.file_name ?? `doc_${doc.file_id}`)
      const caption = ctx.message.caption
      const prompt = buildDocumentMessage(localPath, doc.file_name ?? 'document', caption)
      await handleMessage(ctx, prompt, chatId)
    } catch (err) {
      logger.error({ err }, 'Document handling failed')
      await ctx.reply(`❌ Failed to process document: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  return bot
}
