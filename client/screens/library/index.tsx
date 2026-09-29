import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  TextInput,
  Switch,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Screen } from '@/components/Screen';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import {
  ReaderDoc,
  loadDocs,
  upsertDoc,
  deleteDoc,
  generateId,
  splitParagraphs,
  countChars,
} from '@/utils/readerStore';
import { optimizeText } from '@/utils/api';

const SOURCE_LABEL: Record<ReaderDoc['source'], { label: string; color: string }> = {
  paste: { label: '文本', color: 'bg-amber-100 text-amber-800' },
  ocr: { label: 'OCR', color: 'bg-emerald-100 text-emerald-800' },
  translate: { label: '译文', color: 'bg-sky-100 text-sky-800' },
  sample: { label: '示例', color: 'bg-stone-200 text-stone-700' },
};

interface DocCardProps {
  doc: ReaderDoc;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function DocCard({ doc, onOpen, onDelete }: DocCardProps) {
  const meta = SOURCE_LABEL[doc.source] || SOURCE_LABEL.paste;
  const preview = doc.content.replace(/\s+/g, ' ').slice(0, 80);
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onOpen(doc.id)}
      className="bg-white dark:bg-stone-800 rounded-2xl p-4 mb-4 shadow-sm"
      style={{ shadowColor: '#b45309', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-lg font-bold text-stone-900 dark:text-stone-100" numberOfLines={1}>
            {doc.title || '未命名文档'}
          </Text>
          <View className="flex-row items-center gap-2 mt-2">
            <Text className={`text-xs font-medium px-2 py-0.5 rounded-md ${meta.color}`}>{meta.label}</Text>
            <Text className="text-xs text-stone-400">{countChars(doc.content)} 字</Text>
            <Text className="text-xs text-stone-400">· 标注 {doc.annotations.length}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => onDelete(doc.id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          className="bg-stone-100 dark:bg-stone-700 rounded-full w-8 h-8 items-center justify-center"
        >
          <FontAwesome6 name="trash-can" size={13} color="#a8a29e" />
        </TouchableOpacity>
      </View>
      <Text className="text-sm text-stone-500 dark:text-stone-400 mt-3 leading-5" numberOfLines={2}>
        {preview || '（空白文档）'}
      </Text>
      <View className="mt-3 h-1 bg-stone-100 dark:bg-stone-700 rounded-full overflow-hidden">
        <View className="h-full bg-amber-600 rounded-full" style={{ width: `${Math.min(100, doc.progress * 100)}%` }} />
      </View>
    </TouchableOpacity>
  );
}

export default function LibraryScreen() {
  const router = useSafeRouter();
  const [docs, setDocs] = useState<ReaderDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // 新增文档弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [smartLayout, setSmartLayout] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    let list = await loadDocs();
    if (list.length === 0) {
      try {
        const seeded = await AsyncStorage.getItem('reader_seeded_v1');
        if (!seeded) {
          await upsertDoc({
            id: await generateId(),
            title: '示例 · 无声的阅读',
            content:
              '触摸纸页，是阅读最初的仪式。\n\n墨读将你粘贴、识别或翻译的每一个字，都重新整理成舒适的版心，让文字在方寸屏幕间自由呼吸。\n\n选中任意段落，可以高亮重点，也可以划出下划线——每一处标注，都是思想的锚点。\n\n需要跨语言阅读时，翻译页支持中文、英语、日语、韩语互译，译文可一键导入书库继续阅读。\n\n愿每一次翻页，都是与更好的自己相遇。',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            source: 'sample',
            annotations: [],
            progress: 0,
            charCount: countChars(
              '触摸纸页，是阅读最初的仪式。墨读将你粘贴、识别或翻译的每一个字，都重新整理成舒适的版心。'
            ),
          });
          await AsyncStorage.setItem('reader_seeded_v1', '1');
          list = await loadDocs();
        }
      } catch {
        // 播种失败不影响主流程
      }
    }
    setDocs(list);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const openDoc = useCallback(
    (id: string) => {
      router.push('/reader', { docId: id });
    },
    [router]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteDoc(id);
      Toast.show({ type: 'success', text1: '已删除' });
      refresh();
    },
    [refresh]
  );

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      Toast.show({ type: 'error', text1: '内容为空', text2: '请粘贴或输入需要导入的文本' });
      return;
    }
    setSubmitting(true);
    try {
      let finalContent = content.trim();
      if (smartLayout && finalContent.length > 0) {
        try {
          const optimized = await optimizeText(finalContent);
          if (optimized && optimized.trim()) finalContent = optimized.trim();
        } catch (e) {
          Toast.show({
            type: 'error',
            text1: '智能排版失败',
            text2: e instanceof Error ? e.message : '已使用原始文本导入',
          });
        }
      }
      const id = await generateId();
      const doc: ReaderDoc = {
        id,
        title: title.trim() || '未命名文档',
        content: finalContent,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'paste',
        annotations: [],
        progress: 0,
        charCount: countChars(finalContent),
      };
      await upsertDoc(doc);
      setModalVisible(false);
      setTitle('');
      setContent('');
      Toast.show({ type: 'success', text1: '已导入书库' });
      refresh();
    } finally {
      setSubmitting(false);
    }
  }, [content, title, smartLayout, refresh]);

  const paragraphCount = useMemo(() => splitParagraphs(content).length, [content]);

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']} statusBarStyle="auto">
      <View style={{ paddingTop: 24 }} className="px-5 flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-5">
          <View>
            <Text className="text-3xl font-bold text-stone-900 dark:text-stone-100">墨读</Text>
            <Text className="text-sm text-stone-500 mt-1">智能排版 · 四语翻译 · 图文标记</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => router.push('/ocr')}
              className="flex-row items-center bg-white dark:bg-stone-800 rounded-full px-3 py-2.5 border border-stone-200 dark:border-stone-700"
            >
              <FontAwesome6 name="wand-magic-sparkles" size={14} color="#b45309" />
              <Text className="font-medium text-stone-700 dark:text-stone-200 ml-1.5">OCR</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setModalVisible(true)}
              className="flex-row items-center bg-amber-700 rounded-full px-4 py-2.5"
              style={{ shadowColor: '#b45309', shadowOpacity: 0.28, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
            >
              <FontAwesome6 name="plus" size={14} color="#ffffff" />
              <Text className="text-white font-semibold ml-1.5">导入</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#b45309" />
          </View>
        ) : docs.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <View className="bg-amber-100 rounded-full w-20 h-20 items-center justify-center mb-5">
              <FontAwesome6 name="book-open" size={30} color="#b45309" />
            </View>
            <Text className="text-base font-semibold text-stone-800 dark:text-stone-100">书库空空如也</Text>
            <Text className="text-sm text-stone-500 text-center mt-2 leading-5">
              点击「导入」粘贴文本，或通过图片识别(OCR)一键提取书页文字
            </Text>
            <View className="flex-row gap-3 mt-6">
              <TouchableOpacity onPress={() => router.push('/ocr')} className="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-full px-5 py-3">
                <Text className="font-semibold text-stone-700 dark:text-stone-200">图片识别 (OCR)</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setModalVisible(true)} className="bg-amber-700 rounded-full px-5 py-3">
                <Text className="text-white font-semibold">粘贴文本</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <FlatList
            data={docs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => <DocCard doc={item} onOpen={openDoc} onDelete={handleDelete} />}
          />
        )}
      </View>

      {/* 导入弹窗 */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View className="flex-1 bg-black/40 justify-end">
            <View className="bg-stone-50 dark:bg-stone-900 rounded-t-3xl px-5 pt-6 pb-8" style={{ height: '86%' }}>
              <View className="flex-row items-center justify-between mb-5">
                <Text className="text-xl font-bold text-stone-900 dark:text-stone-100">粘贴文本导入</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <FontAwesome6 name="xmark" size={20} color="#78716c" />
                </TouchableOpacity>
              </View>

              <View className="mb-4">
                <Text className="text-sm text-stone-500 dark:text-stone-400 mb-2">标题（可选）</Text>
                <TextInput
                  value={title}
                  onChangeText={setTitle}
                  placeholder="给这篇文档起个名字"
                  placeholderTextColor="#a8a29e"
                  className="bg-white dark:bg-stone-800 rounded-xl px-4 py-3 text-stone-900 dark:text-stone-100"
                />
              </View>

              <View className="mb-3">
                <Text className="text-sm text-stone-500 dark:text-stone-400 mb-2">正文</Text>
                <TextInput
                  value={content}
                  onChangeText={setContent}
                  placeholder="粘贴或输入任意文本，将自动适配屏幕排版"
                  placeholderTextColor="#a8a29e"
                  multiline
                  textAlignVertical="top"
                  className="bg-white dark:bg-stone-800 rounded-xl px-4 py-3 text-stone-900 dark:text-stone-100"
                  style={{ minHeight: 220 }}
                />
              </View>

              <View className="flex-row items-center justify-between bg-white dark:bg-stone-800 rounded-xl px-4 py-3 mb-4">
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-medium text-stone-800 dark:text-stone-100">智能排版优化</Text>
                  <Text className="text-xs text-stone-500 mt-0.5">自动清理噪音、规范分段、适配移动阅读</Text>
                </View>
                <Switch value={smartLayout} onValueChange={setSmartLayout} trackColor={{ true: '#b45309' }} />
              </View>

              <Text className="text-xs text-stone-400 mb-4">
                当前正文：{countChars(content)} 字 · {paragraphCount} 段
              </Text>

              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  className="flex-1 bg-stone-200 dark:bg-stone-700 rounded-xl py-3.5 items-center"
                >
                  <Text className="font-semibold text-stone-700 dark:text-stone-200">取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={submitting}
                  className="flex-[2] bg-amber-700 rounded-xl py-3.5 items-center flex-row justify-center"
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <FontAwesome6 name="download" size={14} color="#fff" />
                      <Text className="text-white font-semibold ml-2">导入书库</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}