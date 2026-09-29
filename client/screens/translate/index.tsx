import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { FontAwesome6 } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { translateStream, LangCode } from '@/utils/api';
import { upsertDoc, generateId, countChars } from '@/utils/readerStore';
import { useSafeRouter } from '@/hooks/useSafeRouter';

type LangOption = LangCode | 'auto';
const LANGS: { code: LangOption; label: string; short: string }[] = [
  { code: 'auto', label: '自动检测', short: '自动' },
  { code: 'zh', label: '中文', short: '中' },
  { code: 'en', label: '英语', short: '英' },
  { code: 'ja', label: '日语', short: '日' },
  { code: 'ko', label: '韩语', short: '韩' },
];
const LANGS_NO_AUTO = LANGS.filter((l) => l.code !== 'auto');

function LangChips({
  value,
  onChange,
  allowAuto,
}: {
  value: LangOption;
  onChange: (v: LangOption) => void;
  allowAuto: boolean;
}) {
  const items = allowAuto ? LANGS : LANGS_NO_AUTO;
  return (
    <View className="flex-row flex-wrap gap-2">
      {items.map((l) => {
        const active = l.code === value;
        return (
          <TouchableOpacity
            key={l.code}
            onPress={() => onChange(l.code)}
            className={`px-3 py-2 rounded-full border ${active ? 'bg-amber-700 border-amber-700' : 'bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700'}`}
          >
            <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-stone-600 dark:text-stone-300'}`}>
              {l.short}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TranslateScreen() {
  const router = useSafeRouter();
  const [source, setSource] = useState<LangOption>('auto');
  const [target, setTarget] = useState<LangCode>('en');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [translating, setTranslating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);

  const handleTranslate = () => {
    if (!input.trim()) {
      Toast.show({ type: 'error', text1: '请输入待翻译内容' });
      return;
    }
    if (translating) return;
    setTranslating(true);
    setOutput('');
    translateStream({
      text: input.trim(),
      source,
      target,
      onChunk: (delta) => setOutput((prev) => prev + delta),
      onDone: () => setTranslating(false),
      onError: (msg) => {
        setTranslating(false);
        Toast.show({ type: 'error', text1: '翻译失败', text2: msg });
      },
    });
  };

  const swapLang = () => {
    if (source === 'auto') return;
    const src = source;
    setSource(target);
    setTarget(src as LangCode);
    setOutput(input);
    setInput(output);
  };

  const handleCopy = () => {
    if (!output) return;
    Clipboard.setStringAsync(output).then(() => Toast.show({ type: 'success', text1: '译文已复制' }));
  };

  const handleImport = async () => {
    if (!output.trim()) return;
    setOptimizing(true);
    try {
      const id = await generateId();
      await upsertDoc({
        id,
        title: `译文 · ${output.slice(0, 20)}`,
        content: output.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'translate',
        annotations: [],
        progress: 0,
        charCount: countChars(output.trim()),
      });
      Toast.show({ type: 'success', text1: '已导入书库' });
      router.push('/reader', { docId: id });
    } finally {
      setOptimizing(false);
    }
  };

  const targetLangLabel = LANGS.find((l) => l.code === target)?.label || '';

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} statusBarStyle="auto">
      <ScrollView style={{ paddingTop: 16 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between mb-5">
          <View>
            <Text className="text-3xl font-bold text-stone-900 dark:text-stone-100">翻译</Text>
            <Text className="text-sm text-stone-500 mt-1">中日英韩 · 实时互译</Text>
          </View>
          <View className="bg-amber-100 rounded-full px-3 py-1.5">
            <Text className="text-amber-800 font-semibold">{targetLangLabel}</Text>
          </View>
        </View>

        {/* 语言选择 */}
        <View className="bg-white dark:bg-stone-800 rounded-2xl p-4 mb-4 shadow-sm" style={{ shadowColor: '#b45309', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
          <Text className="text-xs text-stone-400 mb-2">源语言</Text>
          <LangChips value={source} onChange={setSource} allowAuto />
          <View className="flex-row items-center my-3">
            <View className="flex-1 h-px bg-stone-200 dark:bg-stone-700" />
            <TouchableOpacity onPress={swapLang} className="mx-3 bg-stone-100 dark:bg-stone-700 rounded-full w-8 h-8 items-center justify-center">
              <FontAwesome6 name="arrow-right-arrow-left" size={13} color="#78716c" />
            </TouchableOpacity>
            <View className="flex-1 h-px bg-stone-200 dark:bg-stone-700" />
          </View>
          <Text className="text-xs text-stone-400 mb-2">目标语言</Text>
          <LangChips value={target} onChange={(v) => setTarget(v as LangCode)} allowAuto={false} />
        </View>

        {/* 原文输入 */}
        <View className="bg-white dark:bg-stone-800 rounded-2xl p-4 mb-4 shadow-sm" style={{ shadowColor: '#b45309', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">原文</Text>
            <Text className="text-xs text-stone-400">{countChars(input)} 字</Text>
          </View>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入或粘贴需要翻译的文本…"
            placeholderTextColor="#a8a29e"
            multiline
            textAlignVertical="top"
            className="bg-stone-50 dark:bg-stone-900 rounded-xl px-4 py-3 text-stone-900 dark:text-stone-100"
            style={{ minHeight: 120 }}
          />
          <TouchableOpacity
            onPress={handleTranslate}
            disabled={translating}
            className="mt-3 bg-amber-700 rounded-xl py-3.5 items-center flex-row justify-center"
            style={{ shadowColor: '#b45309', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
          >
            {translating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <FontAwesome6 name="language" size={15} color="#fff" />
                <Text className="text-white font-semibold ml-2">开始翻译</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* 译文结果 */}
        <View className="bg-white dark:bg-stone-800 rounded-2xl p-4 shadow-sm" style={{ shadowColor: '#b45309', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">译文</Text>
            {output ? (
              <View className="flex-row gap-3">
                <TouchableOpacity onPress={handleCopy} className="flex-row items-center">
                  <FontAwesome6 name="copy" size={13} color="#78716c" />
                  <Text className="text-xs ml-1 text-stone-500">复制</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleImport} className="flex-row items-center" disabled={optimizing}>
                  {optimizing ? (
                    <ActivityIndicator size="small" color="#b45309" />
                  ) : (
                    <>
                      <FontAwesome6 name="book-open" size={13} color="#b45309" />
                      <Text className="text-xs ml-1 text-amber-700">导入阅读</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          {output ? (
            <Text className="text-base leading-7 text-stone-800 dark:text-stone-100">{output}</Text>
          ) : translating ? (
            <View className="flex-row items-center py-4">
              <ActivityIndicator size="small" color="#b45309" />
              <Text className="text-stone-400 ml-3">正在翻译…</Text>
            </View>
          ) : (
            <Text className="text-stone-300 dark:text-stone-600 py-4">译文将在这里逐字呈现</Text>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}