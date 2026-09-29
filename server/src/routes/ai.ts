import { Router } from 'express';
import multer from 'multer';
import { LLMClient, Config, HeaderUtils, type Message } from 'coze-coding-dev-sdk';

const router = Router();

/** 将 Node IncomingHttpHeaders 转为 SDK 需要的普通对象 */
function forwardHeaders(headers: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') out[k] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') out[k] = v[0];
  }
  return out;
}

// 默认使用旗舰模型，同时支持图片/文字多模态输入
const DEFAULT_MODEL = 'doubao-seed-2-0-pro-260215';

// 内存存储，便于转 base64 交给视觉模型
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

export const LANG_NAMES: Record<string, string> = {
  zh: '中文',
  en: '英语',
  ja: '日语',
  ko: '韩语',
};

/**
 * POST /api/v1/ai/translate
 * 中日英韩四语互译，SSE 流式返回译文。
 * Body: { text: string, source: 'zh'|'en'|'ja'|'ko', target: 'zh'|'en'|'ja'|'ko' }
 */
router.post('/translate', async (req, res) => {
  const { text, source, target } = req.body || {};
  if (!text || !target || !LANG_NAMES[target]) {
    res.status(400).json({ error: '缺少翻译参数（text/target）或目标语言不受支持' });
    return;
  }
  const sourceName = LANG_NAMES[source] || '自动识别';
  const targetName = LANG_NAMES[target];

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform, must-revalidate');
  res.setHeader('Connection', 'keep-alive');

  const customHeaders = HeaderUtils.extractForwardHeaders(forwardHeaders(req.headers));
  const client = new LLMClient(new Config(), customHeaders);

  const messages: Message[] = [
    {
      role: 'system',
      content:
        '你是一名专业、严谨的翻译引擎。你只输出目标语言的译文正文，不做任何解释、不输出额外说明、不添加引号或 markdown 格式。若文本跨多个段落，请保留原段落结构。译文要自然、地道、准确。',
    },
    {
      role: 'user',
      content: `源语言：${sourceName}\n目标语言：${targetName}\n\n请将以下文本翻译成${targetName}：\n${text}`,
    },
  ];

  try {
    const stream = client.stream(messages, { model: DEFAULT_MODEL, temperature: 0.3 });
    for await (const chunk of stream) {
      if (chunk.content) {
        res.write(`data: ${JSON.stringify({ text: chunk.content.toString() })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : '翻译失败';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

/**
 * POST /api/v1/ai/ocr
 * 识别图片中的文字内容并提取。multipart/form-data，字段名 image。
 */
router.post('/ocr', upload.single('image'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: '未接收到图片文件（字段名应为 image）' });
    return;
  }
  const base64 = file.buffer.toString('base64');
  const dataUri = `data:${file.mimetype || 'image/jpeg'};base64,${base64}`;

  const customHeaders = HeaderUtils.extractForwardHeaders(forwardHeaders(req.headers));
  const client = new LLMClient(new Config(), customHeaders);

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '请识别这张图片中的所有文字内容，并将其原样、完整地逐字输出（保留原有的段落与换行）。不要翻译，不要添加任何注释、说明或额外文字。',
        },
        { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
      ],
    },
  ] as Message[];

  try {
    const response = await client.invoke(messages, { model: DEFAULT_MODEL, temperature: 0.1 });
    res.json({ text: response.content || '' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'OCR 识别失败';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/v1/ai/text-optimize
 * 智能优化排版：清理噪音、规范标点、合理分段，输出适合移动端阅读的正文。
 * Body: { text: string }
 */
router.post('/text-optimize', async (req, res) => {
  const { text } = req.body || {};
  if (!text) {
    res.status(400).json({ error: '缺少待优化文本' });
    return;
  }
  if (text.length > 20000) {
    res.status(400).json({ error: '文本过长，请拆分后优化（单次不超过20000字）' });
    return;
  }

  const customHeaders = HeaderUtils.extractForwardHeaders(forwardHeaders(req.headers));
  const client = new LLMClient(new Config(), customHeaders);

  const messages: Message[] = [
    {
      role: 'system',
      content:
        '你是一名文本排版与编辑助手。你负责把杂乱的输入文本整理成规范的、适合移动端阅读的正文。规则：1) 去除多余空行、连续空白与无意义占位符；2) 按语义自然分段，段落间以单个空行分隔；3) 保留原文事实与措辞，只做排版整理，不得改写内容、不得增删信息；4) 只输出整理后的正文，不要任何解释。',
    },
    { role: 'user', content: text },
  ];

  try {
    const response = await client.invoke(messages, { model: DEFAULT_MODEL, temperature: 0.2 });
    res.json({ text: response.content || text });
  } catch (err) {
    const message = err instanceof Error ? err.message : '排版优化失败';
    res.status(500).json({ error: message });
  }
});

export default router;