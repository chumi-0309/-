import EventSource from 'react-native-sse';

/** 后端服务地址（由平台注入） */
export const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '').replace(/\/$/, '');

const AI_BASE = `${BACKEND_URL}/api/v1/ai`;

/**
 * 服务端文件：server/src/routes/ai.ts
 * 接口：POST /api/v1/ai/text-optimize
 * Body 参数：text: string
 * 返回：{ text: string }
 */
export async function optimizeText(text: string): Promise<string> {
  const res = await fetch(`${AI_BASE}/text-optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || '排版优化失败');
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

/**
 * 服务端文件：server/src/routes/ai.ts
 * 接口：POST /api/v1/ai/ocr（multipart/form-data）
 * FormData 参数：image: File（此处已拼好含 image 字段的 FormData）
 * 返回：{ text: string }
 */
export async function ocrText(formData: FormData): Promise<string> {
  const res = await fetch(`${AI_BASE}/ocr`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || 'OCR 识别失败');
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

export type LangCode = 'zh' | 'en' | 'ja' | 'ko';

/**
 * 服务端文件：server/src/routes/ai.ts
 * 接口：POST /api/v1/ai/translate（SSE 流式）
 * Body 参数：text: string, source?: LangCode, target: LangCode
 * 通过事件回调增量返回译文文本，error 回调携带错误信息。
 */
export function translateStream(params: {
  text: string;
  source: LangCode | 'auto';
  target: LangCode;
  onChunk: (delta: string) => void;
  onDone: () => void;
  onError: (msg: string) => void;
}): EventSource {
  const { text, source, target, onChunk, onDone, onError } = params;
  const es = new EventSource(`${AI_BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source, target }),
  });

  es.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;
    if (data === '[DONE]') {
      onDone();
      es.close();
      return;
    }
    try {
      const parsed = JSON.parse(data) as { text?: string; error?: string };
      if (parsed.error) {
        onError(parsed.error);
        es.close();
      } else if (parsed.text) {
        onChunk(parsed.text);
      }
    } catch {
      // 忽略无法解析的中间片段
    }
  });

  es.addEventListener('error', (event) => {
    const raw = event as unknown as { message?: string };
    onError(raw.message || '网络异常，翻译中断');
    es.close();
  });

  return es;
}