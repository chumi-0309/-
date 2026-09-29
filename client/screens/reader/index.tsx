import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Modal,
} from 'react-native';
import Clipboard from 'expo-clipboard';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import {
  ReaderDoc,
  AnnotationType,
  getDoc,
  updateAnnotations,
  updateProgress,
  splitParagraphs,
} from '@/utils/readerStore';

type ThemeKey = 'paper' | 'sepia' | 'night';

const THEMES: Record<ThemeKey, { bg: string; text: string; muted: string; bar: string; surface: string }> = {
  paper: { bg: '#FAF6EC', text: '#292524', muted: '#8A8176', bar: '#FFFDF7', surface: '#FFFFFF' },
  sepia: { bg: '#F3E9D2', text: '#433422', muted: '#9A8768', bar: '#F7EFDC', surface: '#F7EFDC' },
  night: { bg: '#1C1917', text: '#E7E5E4', muted: '#A8A29E', bar: '#292524', surface: '#33302E' },
};

const HIGHLIGHT_COLOR = '#FDE68A';
const UNDERLINE_COLOR = '#B45309';

export default function ReaderScreen() {
  const router = useSafeRouter();
  const { docId } = useSafeSearchParams<{ docId: string }>();

  const [doc, setDoc] = useState<ReaderDoc | null>(null);
  const [themeKey, setThemeKey] = useState<ThemeKey>('paper');
  const [fontSize, setFontSize] = useState(18);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [themeModal, setThemeModal] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const theme = THEMES[themeKey];

  useEffect(() => {
    if (docId) {
      getDoc(docId).then((d) => (d ? setDoc(d) : router.back()));
    }
  }, [docId, router]);

  const blocks = useMemo(() => (doc ? splitParagraphs(doc.content) : []), [doc]);

  const annotationsFor = useCallback(
    (blockIndex: number): AnnotationType[] => {
      if (!doc) return [];
      return doc.annotations.filter((a) => a.blockIndex === blockIndex).map((a) => a.type);
    },
    [doc]
  );

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

  const toggleAnnotation = useCallback(
    async (type: AnnotationType) => {
      if (!doc || selectedBlock === null) return;
      const existing = doc.annotations.find(
        (a) => a.blockIndex === selectedBlock && a.type === type
      );
      const next = existing
        ? doc.annotations.filter((a) => a !== existing)
        : [...doc.annotations, { id: `${Date.now()}-${selectedBlock}-${type}`, blockIndex: selectedBlock, type, createdAt: Date.now() }];
      const updated = { ...doc, annotations: next };
      setDoc(updated);
      await updateAnnotations(doc.id, next);
      Toast.show({ type: 'success', text1: type === 'highlight' ? '已高亮' : '已加下划线' });
    },
    [doc, selectedBlock]
  );

  const clearAnnotation = useCallback(async () => {
    if (!doc || selectedBlock === null) return;
    const next = doc.annotations.filter((a) => a.blockIndex !== selectedBlock);
    const updated = { ...doc, annotations: next };
    setDoc(updated);
    await updateAnnotations(doc.id, next);
    setSelectedBlock(null);
    Toast.show({ type: 'success', text1: '已清除该段标注' });
  }, [doc, selectedBlock]);

  const copyAll = useCallback(() => {
    if (!doc) return;
    Clipboard.setStringAsync(doc.content).then(() =>
      Toast.show({ type: 'success', text1: '全文已复制' })
    );
  }, [doc]);

  const progressPct = doc ? Math.round(Math.min(1, doc.progress) * 100) : 0;

  if (!doc) {
    return (
      <Screen statusBarStyle="auto">
        <View className="flex-1 items-center justify-center"><Text className="text-stone-400">加载中…</Text></View>
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
        contentContainerStyle={{ paddingHorizontal: 26, paddingVertical: 24, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 进度示意文案 */}
        {blocks.map((block, idx) => {
          const annots = annotationsFor(idx);
          const highlighted = annots.includes('highlight');
          const underlined = annots.includes('underline');
          const selected = selectedBlock === idx;
          return (
            <TouchableOpacity
              key={`${idx}-${block.slice(0, 8)}`}
              activeOpacity={0.75}
              onPress={() => setSelectedBlock(selected ? null : idx)}
              className="mb-6"
            >
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
                  backgroundColor: highlighted ? HIGHLIGHT_COLOR : 'transparent',
                  textDecorationLine: underlined ? 'underline' : 'none',
                  textDecorationColor: UNDERLINE_COLOR,
                  borderRadius: 4,
                  paddingVertical: highlighted ? 2 : 0,
                }}
              >
                {block}
              </Text>
              {selected && (
                <View style={{ backgroundColor: theme.surface }} className="absolute top-2 right-2 flex-row items-center px-2.5 py-1 rounded-full shadow-sm">
                  <Text numberOfLines={1} className="text-xs font-semibold" style={{ color: theme.muted }}>
                    已选中此段
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 底部选中块操作条 */}
      {selectedBlock !== null ? (
        <View
          style={{ backgroundColor: theme.bar }}
          className="absolute bottom-0 left-0 right-0 flex-row items-center justify-around px-4 py-4 border-t border-stone-200/40"
        >
          <SegBtn icon="highlighter" label="高亮" color={HIGHLIGHT_COLOR} onPress={() => toggleAnnotation('highlight')} />
          <SegBtn icon="underline" label="下划线" color={UNDERLINE_COLOR} onPress={() => toggleAnnotation('underline')} />
          <TouchableOpacity onPress={clearAnnotation} className="items-center">
            <FontAwesome6 name="eraser" size={20} color={theme.muted} />
            <Text className="text-xs mt-1" style={{ color: theme.muted }}>清除</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedBlock(null)} className="items-center">
            <FontAwesome6 name="check" size={20} color="#b45309" />
            <Text className="text-xs mt-1 text-amber-700">完成</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* 底部阅读设置条 */
        <View
          style={{ backgroundColor: theme.bar }}
          className="absolute bottom-0 left-0 right-0 flex-row items-center justify-between px-6 py-3 border-t border-stone-200/40"
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

function SegBtn({
  icon,
  label,
  color,
  onPress,
}: {
  icon: 'highlighter' | 'underline';
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} className="items-center">
      <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: `${color}55` }}>
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