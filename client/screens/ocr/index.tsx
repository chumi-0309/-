import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { FontAwesome6 } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { Screen } from '@/components/Screen';
import { createFormDataFile } from '@/utils';
import { ocrText } from '@/utils/api';
import { upsertDoc, generateId, countChars } from '@/utils/readerStore';
import { useSafeRouter } from '@/hooks/useSafeRouter';

export default function OcrScreen() {
  const router = useSafeRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);

  const requestPermission = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: 'error', text1: '需要相册权限以选择图片' });
      return false;
    }
    return true;
  };

  const pickImage = async () => {
    const ok = await requestPermission();
    if (!ok) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets?.length) {
      setImageUri(result.assets[0].uri);
      setText('');
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: 'error', text1: '需要相机权限' });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
    });
    if (!result.canceled && result.assets?.length) {
      setImageUri(result.assets[0].uri);
      setText('');
    }
  };

  const recognize = async () => {
    if (!imageUri) {
      Toast.show({ type: 'error', text1: '请先选择或拍摄一张包含文字的图片' });
      return;
    }
    setRecognizing(true);
    try {
      const file = await createFormDataFile(imageUri, 'ocr.jpg', 'image/jpeg');
      const formData = new FormData();
      formData.append('image', file as any);
      const result = await ocrText(formData);
      setText(result);
    } catch (e) {
      Toast.show({ type: 'error', text1: '识别失败', text2: e instanceof Error ? e.message : '请重试' });
    } finally {
      setRecognizing(false);
    }
  };

  const importToLibrary = async () => {
    if (!text.trim()) return;
    setImporting(true);
    try {
      const id = await generateId();
      await upsertDoc({
        id,
        title: `扫描识别 · ${text.slice(0, 16)}`,
        content: text.trim(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'ocr',
        annotations: [],
        progress: 0,
        charCount: countChars(text.trim()),
      });
      Toast.show({ type: 'success', text1: '已识别并导入书库' });
      router.push('/reader', { docId: id });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Screen safeAreaEdges={['top', 'left', 'right', 'bottom']} statusBarStyle="auto">
      <View className="px-4 py-3 flex-row items-center border-b border-stone-200/40">
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} className="flex-row items-center">
          <FontAwesome6 name="arrow-left" size={18} color="#292524" />
        </TouchableOpacity>
        <Text className="text-base font-bold text-stone-900 ml-3">图片文字识别</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* 选图区 */}
        {imageUri ? (
          <View className="rounded-2xl overflow-hidden mb-4 shadow-sm" style={{ shadowColor: '#b45309', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
            <Image source={imageUri} className="w-full" style={{ aspectRatio: 4 / 3 }} contentFit="cover" />
          </View>
        ) : (
          <View className="bg-white dark:bg-stone-800 rounded-2xl border-2 border-dashed border-stone-300 dark:border-stone-600 items-center py-12 mb-4">
            <View className="bg-amber-100 rounded-full w-16 h-16 items-center justify-center mb-4">
              <FontAwesome6 name="image" size={26} color="#b45309" />
            </View>
            <Text className="text-stone-400 text-sm">选择或拍摄包含文字的图片</Text>
          </View>
        )}

        {/* 操作按钮 */}
        <View className="flex-row gap-3 mb-5">
          <TouchableOpacity onPress={pickImage} className="flex-1 bg-white dark:bg-stone-800 rounded-xl py-3.5 items-center flex-row justify-center border border-stone-200 dark:border-stone-700">
            <FontAwesome6 name="photo-film" size={15} color="#b45309" />
            <Text className="font-semibold text-stone-700 dark:text-stone-200 ml-2">相册选图</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={takePhoto} className="flex-1 bg-white dark:bg-stone-800 rounded-xl py-3.5 items-center flex-row justify-center border border-stone-200 dark:border-stone-700">
            <FontAwesome6 name="camera" size={15} color="#b45309" />
            <Text className="font-semibold text-stone-700 dark:text-stone-200 ml-2">拍摄</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={recognize}
          disabled={recognizing || !imageUri}
          className="bg-amber-700 rounded-xl py-4 items-center flex-row justify-center mb-6"
          style={!imageUri ? { opacity: 0.4 } : { shadowColor: '#b45309', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
        >
          {recognizing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <FontAwesome6 name="wand-magic-sparkles" size={16} color="#fff" />
              <Text className="text-white font-semibold ml-2">识别图中文字</Text>
            </>
          )}
        </TouchableOpacity>

        {/* 识别结果 */}
        {text || recognizing ? (
          <View className="bg-white dark:bg-stone-800 rounded-2xl p-4 shadow-sm" style={{ shadowColor: '#b45309', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-sm font-semibold text-stone-700 dark:text-stone-200">识别结果</Text>
              <Text className="text-xs text-stone-400">{countChars(text)} 字</Text>
            </View>
            {recognizing && !text ? (
              <View className="flex-row items-center py-4">
                <ActivityIndicator size="small" color="#b45309" />
                <Text className="text-stone-400 ml-3">正在识别图片文字…</Text>
              </View>
            ) : (
              <>
                <Text className="text-base leading-7 text-stone-800 dark:text-stone-100">{text}</Text>
                <TouchableOpacity
                  onPress={importToLibrary}
                  disabled={importing}
                  className="mt-4 bg-amber-700 rounded-xl py-3 items-center flex-row justify-center"
                >
                  {importing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <FontAwesome6 name="book-open" size={15} color="#fff" />
                      <Text className="text-white font-semibold ml-2">导入书库并阅读</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}