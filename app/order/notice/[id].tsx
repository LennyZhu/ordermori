import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { Alert, AppState, Image, Pressable, ScrollView, Text, UIManager, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../../../src/AppProvider';
import { DomainError, editable, errorMessage } from '../../../src/domain/model';
import { buildNotice, noticeProblems, noticeSourceKey, templateName, NOTICE_TEMPLATES } from '../../../src/domain/notice';
import type { NoticeContext, NoticeDocument, NoticeFileRecord, NoticePreferences, NoticeTemplate } from '../../../src/domain/notice';
import { noticeFailure } from '../../../src/domain/noticeDiagnostics';
import { canSaveNoticePreview, initialNoticePreview, noticePreviewReducer, noticeRenderIdentity } from '../../../src/domain/noticePreviewState';
import { persistNoticePng } from '../../../src/data/noticeFiles';
import { NoticeCapture, releaseNoticeCapture } from '../../../src/ui/NoticeCapture';
import type { NoticePreview } from '../../../src/ui/NoticeCapture';
import { NoticeFilesModal } from '../../../src/ui/NoticeFilesModal';
import { NoticeExportActions } from '../../../src/ui/NoticeExportActions';
import { prepareNativeNoticeExport } from '../../../src/data/noticeExportNative';
import { ActionButton, TextAction, e } from '../../../src/ui/editorial';
import { ErrorNotice, Loading, color, s } from '../../../src/ui/common';

export default function NoticeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { store, version } = useApp(); const router = useRouter();
  const [context, setContext] = useState<NoticeContext | null>(null); const [files, setFiles] = useState<NoticeFileRecord[]>([]);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0); const [busy, setBusy] = useState(false); const [history, setHistory] = useState(false);
  const [selection, setSelection] = useState<NoticeTemplate | null>(null); const [switchFailed, setSwitchFailed] = useState(false);
  const lock = useRef(false); const reloadEpoch = useRef(0); const alive = useRef(true); const logTemplate = useRef<NoticeTemplate>('editorial'); const { width } = useWindowDimensions();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useFocusEffect(useCallback(() => { setRetry((n) => n + 1); }, []));
  useEffect(() => {
    let active = true; const epoch = ++reloadEpoch.current;
    Promise.all([store.getNoticeContext(id), store.listNoticeFiles(id).catch((cause: unknown) => { throw noticeFailure('file-list', logTemplate.current, cause); })]).then(([next, saved]) => { if (active && epoch === reloadEpoch.current) { setContext(next); setFiles(saved); setError(''); } }).catch((cause: unknown) => { if (active && epoch === reloadEpoch.current) setError(noticeFailure('settings-read', logTemplate.current, cause).message); });
    return () => { active = false; };
  }, [id, store, version, retry]);
  const derived = useMemo(() => {
    if (!context) return { document: null, problems: [] };
    const problems = noticeProblems(context);
    try { return { document: problems.length ? null : buildNotice(context), problems }; }
    catch (cause) { return { document: null, problems: [errorMessage(cause)] }; }
  }, [context]);
  async function preferences(input: Pick<NoticePreferences, 'template' | 'includeNote'> & { confirmedNote?: string }) {
    if (!context || lock.current) return; lock.current = true; const epoch = ++reloadEpoch.current;
    logTemplate.current = input.template; setSelection(input.template); setSwitchFailed(false); setBusy(true); setError('');
    let wrote = false;
    try {
      await store.saveNoticePreferences(id, context.detail.order.revision, context.preferences.revision, input);
      wrote = true;
      const [next, saved] = await Promise.all([store.getNoticeContext(id), store.listNoticeFiles(id).catch((cause: unknown) => { throw noticeFailure('file-list', input.template, cause); })]);
      if (alive.current && epoch === reloadEpoch.current) { setContext(next); setFiles(saved); setSelection(null); }
    } catch (cause) {
      const failure = noticeFailure(wrote ? 'settings-read' : 'settings-write', input.template, cause);
      if (alive.current && epoch === reloadEpoch.current) { setError(failure.message); setSwitchFailed(true); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function confirmNote() {
    if (!context) return;
    if (context.preferences.includeNote) { void preferences({ ...context.preferences, includeNote: false }); return; }
    consentNote();
  }
  function consentNote() {
    if (!context) return;
    Alert.alert('把此備註提供給客人？', `請核對內容不含內部紀錄、私人聯絡方式或配送地址。只有此明確確認版本才會輸出。\n\n${context.detail.order.note}`, [
      { text: '不包含', style: 'cancel' }, { text: '確認為客戶可見', onPress: () => { void preferences({ ...context.preferences, includeNote: true, confirmedNote: context.detail.order.note }); } },
    ]);
  }
  async function shopSnapshot() {
    if (!context || lock.current) return;
    try {
      const shop = await store.getShop();
      if (!shop.name.trim()) { Alert.alert('請先儲存店舖名稱', '到我的店舖設定名稱後，再返回此頁明確補齊快照。', [{ text: '返回', style: 'cancel' }, { text: '我的店舖', onPress: () => router.push('/(tabs)/shop') }]); return; }
      Alert.alert('補齊此訂單的店舖快照？', `將明確保存目前店名「${shop.name}」及店舖簡介。已有名稱的訂單不會被改寫。`, [
        { text: '取消', style: 'cancel' }, { text: '確認補齊', onPress: () => {
          lock.current = true; setBusy(true); void store.completeNoticeShopSnapshot(id, context.detail.order.revision, shop).then(() => setRetry((n) => n + 1)).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => { lock.current = false; setBusy(false); });
        } },
      ]);
    } catch (cause) { setError(errorMessage(cause)); }
  }
  if (!context || context.detail.order.id !== id) return error ? <View style={e.content}><ErrorNotice message={error} retry={() => setRetry((n) => n + 1)} /></View> : <Loading />;
  const canEdit = editable(context.detail.order);
  const nativeReady = !!UIManager.getViewManagerConfig('RNSVGSvgView');
  const selectedTemplate = selection ?? context.preferences.template;
  const currentFile = derived.document ? files.find((file) => file.orderId === derived.document!.orderId && file.shopId === derived.document!.shopId && file.orderRevision === derived.document!.orderRevision && file.preferencesRevision === derived.document!.preferencesRevision && file.template === derived.document!.template) : undefined;
  const selectionPending = busy || switchFailed || selectedTemplate !== context.preferences.template;
  const controls = <View style={{ paddingHorizontal: 20, paddingTop: 10, gap: 8 }}>
      <View style={[e.row, { gap: 3, backgroundColor: color.mutedSurface, borderRadius: 10, padding: 3 }]}>
        {NOTICE_TEMPLATES.map((template) => <Pressable key={template} accessibilityRole="radio" accessibilityState={{ checked: selectedTemplate === template, disabled: busy || !canEdit }}
          disabled={busy || !canEdit} onPress={() => { if (template !== context.preferences.template || switchFailed) void preferences({ ...context.preferences, template }); }}
          style={({ pressed }) => [{ flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', padding: 6, borderRadius: 8, backgroundColor: template === selectedTemplate ? color.ink : 'transparent' }, pressed && e.pressed]}>
          <Text style={[e.actionText, { color: template === selectedTemplate ? color.surface : color.ink }]}>{templateName[template]}</Text>
        </Pressable>)}
      </View>
      <Text style={e.caption}>兩款模板均免費 · 只讀取已保存的訂單快照</Text>
      {!!context.detail.order.note && <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: context.preferences.includeNote, disabled: busy || !canEdit }} disabled={busy || !canEdit} onPress={confirmNote} style={[e.row, { minHeight: 44 }]}>
        <Ionicons name={context.preferences.includeNote ? 'checkbox' : 'square-outline'} size={21} color={color.ink} /><Text style={[e.caption, { flex: 1 }]}>包含已確認給客人看的訂單備註</Text>
      </Pressable>}
      {!canEdit && <Text style={e.caption}>對外快照已鎖定，通知設定保持原樣。</Text>}
      {!!error && <ErrorNotice message={error} retry={() => setRetry((n) => n + 1)} />}
    </View>;
  const historyControl = <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}><TextAction title={`本機 PNG 檔案 · ${files.length}`} icon="folder-open-outline" onPress={() => setHistory(true)} /></View>;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={s.page}>
    {history ? <ScrollView>{controls}{historyControl}</ScrollView> : selectionPending ? <ScrollView>{controls}<View style={e.content}>
      <Text accessibilityLiveRegion="polite" style={e.body}>{busy ? `正在準備${templateName[selectedTemplate]}…` : `${templateName[selectedTemplate]}尚未完成預覽，沒有沿用其他模板圖片。`}</Text>
      {!busy && <><TextAction title="重試所選模板" onPress={() => { void preferences({ ...context.preferences, template: selectedTemplate }); }} /><TextAction title={`返回已儲存的${templateName[context.preferences.template]}`} onPress={() => { setSelection(null); setSwitchFailed(false); setError(''); }} /></>}
    </View>{historyControl}</ScrollView> : derived.document && nativeReady ? <NoticeWorkspace key={`${derived.document.orderId}:${derived.document.orderRevision}:${derived.document.preferencesRevision}:${width}`} document={derived.document} file={currentFile} width={width - 40} onSaved={() => setRetry((n) => n + 1)} header={controls} footer={historyControl} /> :
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>{controls}<View style={e.content}>
        {derived.problems.map((problem) => <Text key={problem} style={e.body}>{problem}</Text>)}
        {!nativeReady && <Text style={e.body}>請先重新構建包含 view-shot 及 SVG 的 Development Build，才能生成付款通知。</Text>}
        {canEdit && <>
          {!context.detail.order.shop_name_snapshot.trim() && <ActionButton title="明確補齊店舖快照" secondary disabled={busy} onPress={() => { void shopSnapshot(); }} />}
          {context.preferences.includeNote && context.preferences.noteSnapshot !== context.detail.order.note && <TextAction title="重新確認目前備註給客人查看" onPress={consentNote} />}
          <TextAction title="修改訂單及收款快照" icon="create-outline" onPress={() => router.push({ pathname: '/order/edit/[id]', params: { id } })} />
          <Text style={e.caption}>店舖新設定不會回寫舊單。請在修改訂單頁明確選擇已確認的收款方式並儲存；不會新增訂單或扣額度。</Text>
          <TextAction title="管理店舖收款資料" onPress={() => router.push('/shop/payments')} />
        </>}
      </View>{historyControl}</ScrollView>}
    {history && <NoticeFilesModal store={store} files={files} onClose={() => setHistory(false)} onRemoved={() => setRetry((n) => n + 1)} />}
  </SafeAreaView>;
}

function NoticeWorkspace({ document: initialDocument, file, width, onSaved, header, footer }: { document: NoticeDocument; file?: NoticeFileRecord; width: number; onSaved: () => void; header: ReactNode; footer: ReactNode }) {
  const [document] = useState(initialDocument);
  const [initialFile] = useState(file); const [captureEnabled, setCaptureEnabled] = useState(!file); const [reused, setReused] = useState(false); const [exporting, setExporting] = useState(false);
  const { store } = useApp(); const identity = noticeRenderIdentity(document);
  const [state, dispatch] = useReducer(noticePreviewReducer, undefined, () => initialNoticePreview(identity, document.template)); const [busy, setBusy] = useState(false);
  const generation = useRef(1); const preview = state.image;
  const lock = useRef(false); const alive = useRef(true); const temp = useRef<string | null>(null);
  const page = useRef<ComponentRef<typeof ScrollView>>(null); const captureTop = useRef(0); const { height } = useWindowDimensions();
  const prepareCapture = useCallback(() => { page.current?.scrollTo({ y: Math.max(0, captureTop.current), animated: false }); }, []);
  const onSavedRef = useRef(onSaved); useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (temp.current) void releaseNoticeCapture(temp.current); }; }, []);
  useEffect(() => {
    if (!initialFile) return;
    let active = true; const ticket = generation.current;
    void prepareNativeNoticeExport(store, initialFile).then(({ uri }) => {
      if (!active || !alive.current || ticket !== generation.current) return;
      setReused(true);
      dispatch({ type: 'ready', generation: ticket, image: { uri, width: initialFile.width, height: initialFile.height, captureMs: 0, identity, template: document.template } });
      dispatch({ type: 'saved', generation: ticket, identity });
    }).catch((cause: unknown) => {
      if (active && alive.current && ticket === generation.current) dispatch({ type: 'error', generation: ticket, identity, error: noticeFailure('preview-read', document.template, cause).message });
    });
    return () => { active = false; };
  }, [store, initialFile, identity, document.template]);
  function fail(ticket: number, cause: unknown) {
    if (!alive.current || ticket !== generation.current) return;
    const failure = noticeFailure('preview-read', document.template, cause); dispatch({ type: 'error', generation: ticket, identity, error: failure.message });
  }
  async function ready(ticket: number, result: NoticePreview) {
    try {
      if (result.template !== document.template || result.identity !== identity) throw new DomainError('conflict', '預覽模板或資料來源不一致，請重試。');
      const current = buildNotice(await store.getNoticeContext(document.orderId));
      if (!alive.current || ticket !== generation.current || noticeSourceKey(current) !== noticeSourceKey(document) || AppState.currentState !== 'active') throw new DomainError('stale_task', '訂單已改變或任務已取消，請重新預覽。');
      if (temp.current) await releaseNoticeCapture(temp.current);
      if (!alive.current || ticket !== generation.current) { await releaseNoticeCapture(result.uri); return; }
      temp.current = result.uri; dispatch({ type: 'ready', generation: ticket, image: result });
    } catch (cause) { await releaseNoticeCapture(result.uri); fail(ticket, cause); }
  }
  function reset() { generation.current++; setCaptureEnabled(true); setReused(false); if (temp.current) void releaseNoticeCapture(temp.current); temp.current = null; dispatch({ type: 'retry' }); }
  async function save() {
    if (!preview || !canSaveNoticePreview(state, identity, document.template) || lock.current || AppState.currentState !== 'active') return;
    const ticket = state.generation; lock.current = true; setBusy(true);
    try { await persistNoticePng(store, document, preview.uri, () => alive.current && ticket === generation.current && AppState.currentState === 'active'); if (alive.current && ticket === generation.current) { dispatch({ type: 'saved', generation: ticket, identity }); onSavedRef.current(); } }
    catch (cause) { fail(ticket, noticeFailure('save-file', document.template, cause)); } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <ScrollView ref={page} contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}>
    {header}
    <View onLayout={({ nativeEvent: { layout } }) => { captureTop.current = layout.y; }} style={{ height: Math.min(420, Math.max(180, height * 0.46)), marginHorizontal: 20, marginVertical: 10, borderRadius: 12, overflow: preview ? 'hidden' : 'visible', backgroundColor: color.surface }}>
      {preview && state.phase === 'ready' ? <ScrollView nestedScrollEnabled minimumZoomScale={1} maximumZoomScale={4} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never">
        <Image source={{ uri: preview.uri }} resizeMode="contain" style={{ width, height: width * preview.height / preview.width }} onLoad={() => dispatch({ type: 'displayed', generation: state.generation, identity })} onError={() => fail(state.generation, new DomainError('notice', 'PNG 未能顯示，請重新產生。'))} />
      </ScrollView> : state.phase === 'error' ? <View style={e.content}><Text style={e.body}>{templateName[document.template]}預覽未成功，請重試。</Text></View> : captureEnabled ? <NoticeCapture key={state.generation} document={document} width={width} prepare={prepareCapture} onReady={(result) => { void ready(state.generation, result); }} onError={(cause) => fail(state.generation, cause)} /> : <View style={e.content}><Text style={e.caption}>正在讀取已儲存 PNG…</Text></View>}
    </View>
    <View style={{ paddingHorizontal: 20, gap: 8 }}>
      {!!state.error && <ErrorNotice message={state.error} />}
      {preview && <Text style={e.caption}>{templateName[document.template]} PNG · {preview.width} × {preview.height} px · {reused ? '本機已儲存圖片' : `擷取 ${(preview.captureMs / 1000).toFixed(2)} 秒`}。請核對首末商品、總額、收款碼及頁尾；尺寸吻合不等於內容或掃碼驗證通過。</Text>}
      {state.saved && <Text accessibilityLiveRegion="polite" style={[e.caption, { color: color.green }]}>PNG 已保存到 App 本機檔案。分享及相簿副本由你分別操作。</Text>}
      {state.saved && file ? <NoticeExportActions key={file.id} store={store} file={file} onBusyChange={setExporting} /> : <ActionButton title={state.saved ? '已儲存到本機檔案' : '產生並儲存 PNG'} icon="document-outline" disabled={exporting || !canSaveNoticePreview(state, identity, document.template)} busy={busy} onPress={() => { void save(); }} />}
      <TextAction title={state.error ? '重新產生預覽' : '重新產生 / 檢查內容'} disabled={busy || exporting} onPress={reset} />
    </View>
    {footer}
  </ScrollView>;
}
