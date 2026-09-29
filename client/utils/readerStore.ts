import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

export type AnnotationType = 'highlight' | 'underline';

export interface Annotation {
  id: string;
  /** 标注所在的段落块索引 */
  blockIndex: number;
  type: AnnotationType;
  createdAt: number;
}

export interface ReaderDoc {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  source: 'paste' | 'ocr' | 'translate' | 'sample';
  annotations: Annotation[];
  /** 阅读进度 0-1 */
  progress: number;
  /** 实际字符数 */
  charCount: number;
}

const STORAGE_KEY = 'reader_docs_v1';

/** 读取全部文档（按创建时间倒序） */
export async function loadDocs(): Promise<ReaderDoc[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ReaderDoc[];
    return list.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

async function persist(docs: ReaderDoc[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

export async function getDoc(id: string): Promise<ReaderDoc | undefined> {
  const docs = await loadDocs();
  return docs.find((d) => d.id === id);
}

export async function upsertDoc(doc: ReaderDoc): Promise<ReaderDoc> {
  const docs = await loadDocs();
  const idx = docs.findIndex((d) => d.id === doc.id);
  if (idx >= 0) {
    docs[idx] = { ...doc, updatedAt: Date.now() };
  } else {
    docs.unshift({ ...doc, createdAt: Date.now(), updatedAt: Date.now() });
  }
  await persist(docs);
  return idx >= 0 ? docs[idx] : docs[0];
}

export async function deleteDoc(id: string): Promise<void> {
  const docs = await loadDocs();
  await persist(docs.filter((d) => d.id !== id));
}

export async function updateAnnotations(id: string, annotations: Annotation[]): Promise<void> {
  const docs = await loadDocs();
  const idx = docs.findIndex((d) => d.id === id);
  if (idx >= 0) {
    docs[idx].annotations = annotations;
    docs[idx].updatedAt = Date.now();
    await persist(docs);
  }
}

export async function updateProgress(id: string, progress: number): Promise<void> {
  const docs = await loadDocs();
  const idx = docs.findIndex((d) => d.id === id);
  if (idx >= 0) {
    docs[idx].progress = progress;
    await persist(docs);
  }
}

export async function generateId(): Promise<string> {
  return Crypto.randomUUID();
}

/** 将原始文本切成段落块（可按需智能分段，这里做基础切分与清洗） */
export function splitParagraphs(content: string): string[] {
  const cleaned = content
    .replace(/\r\n?/g, '\n')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return cleaned.length ? cleaned : [content];
}

export function countChars(s: string): number {
  return s.replace(/\s/g, '').length;
}