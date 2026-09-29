import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Modal,
  ActivityIndicator,
} from 'react-native';
import type EventSource from 'react-native-sse';
import * as Clipboard from 'expo-clipboard';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import {
  ReaderDoc,
  AnnotationType,
  TextToken,
  getDoc,
  updateAnnotations,
  updateProgress,
  splitParagraphs,
  splitWords,
} from '@/utils/readerStore';
import { translateStream, LangCode } from '@/utils/api';

type ThemeKey = 'paper' | 'sepia' | 'night';

const THEMES: Record<ThemeKey, { bg: string; text: string; muted: string; bar: string; surface: string }> = {
  paper: { bg: '#FAF6EC', text: '#292524', muted: '#8A8176', bar: '#FFFDF7', surface: '#FFFFFF' },
  sepia: { bg: '#F3E9D2', text: '#433422', muted: '#9A8768', bar: '#F7EFDC', surface: '#F7EFDC' },
  night: { bg: '#1C1917', text: '#E7E5E4', muted: '#A8A29E', bar: '#292524', surface: '#33302E' },
};

const HIGHLIGHT_COLOR = '#FDE68A';
const SELECT_COLOR = '#FBBF24';
const UNDERLINE_COLOR = '#B45309';

const LANGS: { code: LangCode; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
];

/** 依据词的字形猜测默认目标语：含中日韩字符→译成英文，否则→译成中文 */
function guessDefaultTarget(text: string): LangCode {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text) ? 'en' : 'zh';
}

interface WordSelection {
  blockIndex: number;
  start: number;
  end: number;
  text: string;
}

export default function ReaderScreen() {
  const router = useSafeRouter();
  const { docId } = useSafeSearchParams<{ docId: string }>();

  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [themeKey, setThemeKey] = useState<ThemeKey>('paper');
  const [fontSize, setFontSize] = useState(18);
  const [themeModal, setThemeModal] = useState(false);
  const [selection, setSelection] = useState<WordSelection | null>(null);
  // 翻译面板状态
  const [tranOpen, setTranOpen] = useState(false);
  const [tranWord, setTranWord] = useState('');
  const [tranTarget, setTranTarget] = useState<LangCode>('zh');
  const [tranResult, setTranResult] = useState('');
  const [translating, setTranslating] = useState(false);
  const [tranError, setTranError] = useState('');

  const scrollRef = useRef<ScrollView>(null);
  const esRef = useRef<EventSource | null>(null);

  const theme = THEMES[themeKey];

  useEffect(() => {
    if (docId) {
      getDoc(docId).then((d) => (d ? setDoc(d) : router.back()));
    }
  }, [docId, router]);

  // 卸载时关闭翻译流
  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const blocks = useMemo(() => (doc ? splitParagraphs(doc.content) : []), [doc]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!doc) return;
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const denominator = contentSize.height - layoutMeasurement.height;
      if (denominator > 0) {
        const progress = Math.min(1, Math.max(0, contentOffset.y / denominator));
        updateProgress(doc.id, progress);
      }
    },
    [doc]
  );

  /** 判断某段某词是否命中指定类型标注（段落级标注覆盖整段所有词） */
  const isTokenAnnotated = useCallback(
    (type: AnnotationType, blockIndex: number, start: number, end: number): boolean => {
      if (!doc) return false;
      return doc.annotations.some(
        (a) =>
          a.blockIndex === blockIndex &&
          a.type === type &&
          (a.start === undefined || (a.start === start && a.end === end))
      );
    },
    [doc]
  );

  /** 选中某个词 */
  const handleSelectWord = useCallback((blockIndex: number, token: TextToken) => {
    setTranOpen(false);
    esRef.current?.close();
    // 点击已选中的词则取消
    setSelection((prev) =>
      prev && prev.blockIndex === blockIndex && prev.start === token.start ? null : { blockIndex, start: token.start, end: token.end, text: token.text }
    );
  }, []);

  /** 对选中词切换一处标注（高亮/下划线） */
  const toggleWordAnnotation = useCallback(
    async (type: AnnotationType) => {
      if (!doc || !selection) return;
      const { blockIndex, start, end } = selection;
      const exists = doc.annotations.find(
        (a) => a.blockIndex === blockIndex && a.type === type && a.start === start && a.end === end
      );
      const next = exists
        ? doc.annotations.filter((a) => a !== exists)
        : [
            ...doc.annotations,
            {
              id: `${Date.now()}-${blockIndex}-${start}-${type}`,
              blockIndex,
              type,
              start,
              end,
              createdAt: Date.now(),
            },
          ];
      const updated = { ...doc, annotations: next };
      setDoc(updated);
      await updateAnnotations(doc.id, next);
      Toast.show({ type: 'success', text1: type === 'highlight' ? '已高亮该词' : '已给该词加下划线' });
    },
    [doc, selection]
  );

  /** 清除选中词的词级标注 */
  const clearWordAnnotation = useCallback(async () => {
    if (!doc || !selection) return;
    const { blockIndex, start, end } = selection;
    const next = doc.annotations.filter(
      (a) => !(a.blockIndex === blockIndex && (a.start === start || a.start === undefined))
    );
    const updated = { ...doc, annotations: next };
    setDoc(updated);
    await updateAnnotations(doc.id, next);
    Toast.show({ type: 'success', text1: '已清除标注' });
  }, [doc, selection]);

  const copyWord = useCallback(() => {
    if (!selection) return;
    Clipboard.setStringAsync(selection.text).then(() =>
      Toast.show({ type: 'success', text1: '已复制所选内容' })
    );
  }, [selection]);

  const copyAll = useCallback(() => {
    if (!doc) return;
    Clipboard.setStringAsync(doc.content).then(() =>
      Toast.show({ type: 'success', text1: '全文已复制' })
    );
  }, [doc]);

  /** 关闭并清理翻译流 */
  const closeTranslate = useCallback(() => {
    esRef.current?.close();
    setTranOpen(false);
    setTranslating(false);
  }, []);

  /** 发起/切换某词的翻译（SSE 流式） */
  const startTranslate = useCallback(
    (word: string, target: LangCode) => {
      esRef.current?.close();
      setTranWord(word);
      setTranTarget(target);
      setTranResult('');
      setTranError('');
      setTranslating(true);
      setTranOpen(true);
      esRef.current = translateStream({
        text: word,
        source: 'auto',
        target,
        onChunk: (delta) => setTranResult((prev) => prev + delta),
        onDone: () => setTranslating(false),
        onError: (msg) => {
          setTranError(msg);
          setTranslating(false);
        },
      });
    },
    []
  );

  const handleTranslateWord = useCallback(() => {
    if (!selection) return;
    startTranslate(selection.text, guessDefaultTarget(selection.text));
  }, [selection, startTranslate]);

  const switchTranslateTarget = useCallback(
    (code: LangCode) => {
      if (!tranWord) return;
      startTranslate(tranWord, code);
    },
    [tranWord, startTranslate]
  );

  const progressPct = doc ? Math.round(Math.min(1, doc.progress) * 100) : 0;

  // ---- 底部操作条按钮 onClick 统一封装，避免重复判断 ----

  if (!doc) {
    return (
      <Screen statusBarStyle="auto">
        <View className="flex-1 items-center justify-center">
          <Text className="text-stone-400">加载中…</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']} statusBarStyle={themeKey === 'night' ? 'light' : 'auto'}>
      {/* 顶栏 */}
      <View style={{ backgroundColor: theme.bar }} className="px-4 py-3 flex-row items-center justify-between border-b border-stone-200/40">
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} className="flex-row items-center">
          <FontAwesome6 name="arrow-left" size={18} color={theme.text} />
        </TouchableOpacity>
        <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>
          {doc.title}
        </Text>
        <TouchableOpacity onPress={copyAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <View className="bg-stone-200/50 rounded-full px-3 py-1.5">
            <Text className="text-xs font-medium" style={{ color: theme.text }}>复制</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 正文 */}
      <ScrollView
        ref={scrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={300}
        style={{ backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingHorizontal: 26, paddingVertical: 24, paddingBottom: 150 }}
        showsVerticalScrollIndicator={false}
      >
        {blocks.map((block, idx) => {
          const tokens = splitWords(block);
          const blockHighlight = isTokenAnnotated('highlight', idx, -1, -1);
          const blockUnderline = isTokenAnnotated('underline', idx, -1, -1);
          return (
            <View key={`${idx}-${block.slice(0, 8)}`} className="mb-6">
              {idx === 0 && (
                <Text className="mb-1 text-xs tracking-widest" style={{ color: theme.muted }}>
                  导语
                </Text>
              )}
              <Text
                style={{
                  color: theme.text,
                  fontSize,
                  lineHeight: Math.round(fontSize * 1.8),
                  textIndent: `${fontSize * 2}px`,
                  backgroundColor: blockHighlight ? HIGHLIGHT_COLOR : 'transparent',
                  textDecorationLine: blockUnderline ? 'underline' : 'none',
                  textDecorationColor: UNDERLINE_COLOR,
                  borderRadius: 4,
                }}
              >
                {tokens.map((tok) => {
                  const isSel =
                    !!selection &&
                    selection.blockIndex === idx &&
                    selection.start === tok.start &&
                    selection.end === tok.end;
                  const isHigh = tok.selectable ? isTokenAnnotated('highlight', idx, tok.start, tok.end) : false;
                  const isUnder = tok.selectable ? isTokenAnnotated('underline', idx, tok.start, tok.end) : false;
                  return (
                    <Text
                      key={`${idx}-${tok.start}-${tok.text}`}
                      onPress={tok.selectable ? () => handleSelectWord(idx, tok) : undefined}
                      suppressHighlighting={!tok.selectable}
                      style={{
                        backgroundColor: isSel ? SELECT_COLOR : isHigh ? HIGHLIGHT_COLOR : 'transparent',
                        textDecorationLine: isUnder ? 'underline' : 'none',
                        textDecorationColor: UNDERLINE_COLOR,
                        borderRadius: 3,
                      }}
                    >
                      {tok.text}
                    </Text>
                  );
                })}
              </Text>
            </View>
          );
        })}
        <View className="py-2 items-center">
          <Text className="text-[11px]" style={{ color: theme.muted }}>— 选中任意字词可高亮、下划线或查询词义 —</Text>
        </View>
      </ScrollView>

      {/* 选中词操作条 */}
      {selection ? (
        <View
          style={{ backgroundColor: theme.bar, borderTopColor: `${theme.muted}22` }}
          className="absolute bottom-0 left-0 right-0 flex-row items-center justify-around px-2 py-3 border-t"
        >
          <WordBtn icon="highlighter" label="高亮" color={HIGHLIGHT_COLOR} onPress={() => toggleWordAnnotation('highlight')} />
          <WordBtn icon="underline" label="下划线" color={UNDERLINE_COLOR} onPress={() => toggleWordAnnotation('underline')} />
          <WordBtn icon="language" label="翻译" color="#2563eb" onPress={handleTranslateWord} />
          <WordBtn icon="copy" label="复制" color="#059669" onPress={copyWord} />
          <WordBtn icon="eraser" label="清除" color={theme.muted} onPress={clearWordAnnotation} />
          <TouchableOpacity onPress={() => setSelection(null)} className="items-center">
            <FontAwesome6 name="check" size={20} color="#b45309" />
            <Text className="text-xs mt-1 text-amber-700">完成</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* 底部阅读设置条 */
        <View
          style={{ backgroundColor: theme.bar, borderTopColor: `${theme.muted}22` }}
          className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-6 py-3 border-t"
        >
          <View className="flex-row items-center gap-4">
            <FontBtn icon="minus" onPress={() => setFontSize((s) => Math.max(14, s - 1))} theme={theme} />
            <View className="w-10 items-center">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{fontSize}</Text>
            </View>
            <FontBtn icon="plus" onPress={() => setFontSize((s) => Math.min(28, s + 1))} theme={theme} />
          </View>
          <View className="flex-row items-center gap-3">
            <TouchableOpacity onPress={() => setThemeModal(true)} className="flex-row items-center bg-stone-200/50 rounded-full px-3 py-2">
              <FontAwesome6 name="palette" size={15} color={theme.text} />
            </TouchableOpacity>
            <View className="flex-row items-center bg-stone-200/50 rounded-full px-3 py-2">
              <FontAwesome6 name="bookmark" size={13} color={theme.muted} />
              <Text className="text-xs font-medium ml-1.5" style={{ color: theme.text }}>{progressPct}%</Text>
            </View>
          </View>
        </View>
      )}

      {/* 词义翻译面板 */}
      <Modal transparent animationType="slide" visible={tranOpen} onRequestClose={closeTranslate}>
        <TouchableOpacity style={{ flex: 1 }} className="justify-end" activeOpacity={1} onPress={closeTranslate}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            className="bg-white dark:bg-stone-800 rounded-t-3xl p-5 pb-8"
            style={{ backgroundColor: theme.surface }}
          >
            <View className="items-center mb-1">
              <View className="w-10 h-1 rounded-full" style={{ backgroundColor: `${theme.muted}55` }} />
            </View>
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-1 flex-row items-center">
                <FontAwesome6 name="language" size={15} color="#2563eb" />
                <Text className="text-base font-bold ml-2" style={{ color: theme.text }} numberOfLines={1}>
                  词义 · {tranWord}
                </Text>
              </View>
              <TouchableOpacity onPress={closeTranslate} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <FontAwesome6 name="xmark" size={16} color={theme.muted} />
              </TouchableOpacity>
            </View>

            {/* 目标语言选择 */}
            <View className="flex-row flex-wrap gap-2 mb-4">
              {LANGS.map((l) => {
                const active = tranTarget === l.code;
                return (
                  <TouchableOpacity
                    key={l.code}
                    onPress={() => switchTranslateTarget(l.code)}
                    className="rounded-full px-3 py-1.5"
                    style={{ backgroundColor: active ? '#2563eb' : `${theme.muted}22` }}
                  >
                    <Text className="text-xs font-medium" style={{ color: active ? '#fff' : theme.text }}>
                      {l.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* 译文结果 */}
            <View
              className="rounded-2xl p-4 min-h-[84px]"
              style={{ backgroundColor: theme.bg }}
            >
              {translating && !tranResult && !tranError ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#2563eb" />
                  <Text className="text-sm" style={{ color: theme.muted }}>正在翻译…</Text>
                </View>
              ) : tranError ? (
                <Text className="text-sm" style={{ color: '#dc2626' }}>{tranError}</Text>
              ) : (
                <Text className="text-[15px] leading-6" style={{ color: theme.text }}>
                  {tranResult || '（无结果）'}
                </Text>
              )}
            </View>

            <TouchableOpacity
              onPress={() => {
                if (selection) {
                  toggleWordAnnotation('highlight');
                }
                closeTranslate();
              }}
              className="mt-4 rounded-xl py-3 items-center"
              style={{ backgroundColor: '#2563eb' }}
            >
              <Text className="text-sm font-semibold text-white">高亮该词并关闭</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* 主题选择弹窗 */}
      <Modal transparent animationType="fade" visible={themeModal} onRequestClose={() => setThemeModal(false)}>
        <TouchableOpacity style={{ flex: 1 }} className="bg-black/40 justify-center px-10" activeOpacity={1} onPress={() => setThemeModal(false)}>
          <View className="bg-white dark:bg-stone-800 rounded-2xl p-5">
            <Text className="text-lg font-bold text-stone-900 dark:text-stone-100 mb-4 text-center">选择阅读背景</Text>
            <View className="flex-row justify-around">
              {(Object.keys(THEMES) as ThemeKey[]).map((k) => {
                const t = THEMES[k];
                const active = k === themeKey;
                return (
                  <TouchableOpacity key={k} onPress={() => { setThemeKey(k); setThemeModal(false); }} className="items-center">
                    <View
                      className="w-16 h-20 rounded-lg border-2 mb-2"
                      style={{ backgroundColor: t.bg, borderColor: active ? '#b45309' : '#e7e5e4' }}
                    >
                      <Text className="text-center mt-6 text-xs" style={{ color: t.text }}>Aa</Text>
                    </View>
                    <Text className={`text-xs ${active ? 'text-amber-700 font-semibold' : 'text-stone-400'}`}>
                      {k === 'paper' ? '纸白' : k === 'sepia' ? '羊皮纸' : '夜读'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </Screen>
  );
}

function WordBtn({
  icon,
  label,
  color,
  onPress,
}: {
  icon: 'highlighter' | 'underline' | 'language' | 'copy' | 'eraser';
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} className="items-center px-1">
      <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: `${color}33` }}>
        <FontAwesome6 name={icon} size={17} color={color} />
      </View>
      <Text className="text-xs mt-1 text-stone-600 dark:text-stone-300">{label}</Text>
    </TouchableOpacity>
  );
}

function FontBtn({
  icon,
  onPress,
  theme,
}: {
  icon: 'minus' | 'plus';
  onPress: () => void;
  theme: { text: string };
}) {
  return (
    <TouchableOpacity onPress={onPress} className="bg-stone-200/50 rounded-full w-9 h-9 items-center justify-center">
      <FontAwesome6 name={icon} size={15} color={theme.text} />
    </TouchableOpacity>
  );
}