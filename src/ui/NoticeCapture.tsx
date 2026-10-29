import { tr } from "../i18n";
import { useLanguage } from "../i18n/react";
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Dimensions, PixelRatio, ScrollView, Text, View } from 'react-native';
import type { ComponentRef, ReactNode } from 'react';
import { DomainError } from '../domain/model';
import { noticeTextBlocks } from '../domain/notice';
import type { NoticeDocument, NoticeTemplate } from '../domain/notice';
import { captureReleasePath, noticeCapturePlan } from '../domain/noticePng';
import type { NoticeSize } from '../domain/noticePng';
import { inspectNoticePng } from '../data/noticeFiles';
import { NoticePaper } from './NoticePaper';
import { e } from './editorial';
import { color } from './common';
import { noticeFailure } from '../domain/noticeDiagnostics';
import type { NoticeStage } from '../domain/noticeDiagnostics';
import { noticeRenderIdentity, withNoticeCaptureDeadline, withNoticeCaptureSlot } from '../domain/noticePreviewState';
import type { NoticePreviewImage } from '../domain/noticePreviewState';

export type NoticePreview = NoticePreviewImage;
export const releaseNoticeCapture = async (uri: string) => { try { const { releaseCapture } = await import('react-native-view-shot'); releaseCapture(captureReleasePath(uri)); } catch { /* Temporary capture only. */ } };
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
export function NoticeCapture({ document, width, prepare, onReady, onError }: {
  document: NoticeDocument; width: number; prepare: () => void; onReady: (result: NoticePreview) => void; onError: (error: Error) => void;
}) {
  useLanguage();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null); const mounted = useRef(true); const started = useRef(false);
  const observation = useRef(0); const measured = useRef<NoticeSize | null>(null); const content = useRef<NoticeSize | null>(null);
  const footer = useRef({ top: 0, bottom: 0 }); const rows = useRef(new Map<string, { top: number; height: number }>()); const texts = useRef(new Set<string>());
  const [signals, setSignals] = useState(0); const [imageReady, setImageReady] = useState(!document.qr); const [decorationReady, setDecorationReady] = useState(document.template !== 'soft');
  const [imageFailed, setImageFailed] = useState(false); const callbacks = useRef({ onReady, onError });
  useEffect(() => { callbacks.current = { onReady, onError }; }, [onReady, onError]);
  useEffect(() => {
    const invalidate = () => { observation.current++; };
    mounted.current = true; const listener = AppState.addEventListener('change', (state) => { if (state !== 'active') invalidate(); });
    const watchdog = setTimeout(() => { if (!started.current && mounted.current) callbacks.current.onError(noticeFailure('layout', document.template, new DomainError('render', '全部文字、商品及素材尚未完成排版，請重試預覽。'))); }, 12000);
    return () => { mounted.current = false; invalidate(); listener.remove(); clearTimeout(watchdog); };
  }, [document.template]);
  const observe = useMemo(() => ({
    layout: ({ nativeEvent: { layout } }: { nativeEvent: { layout: NoticeSize } }) => {
      if (measured.current?.width !== layout.width || measured.current?.height !== layout.height) { measured.current = { width: layout.width, height: layout.height }; observation.current++; setSignals((n) => n + 1); }
    },
    footer: ({ nativeEvent: { layout } }: { nativeEvent: { layout: { y: number; height: number } } }) => { if (footer.current.top !== layout.y || footer.current.bottom !== layout.y + layout.height) { footer.current = { top: layout.y, bottom: layout.y + layout.height }; observation.current++; setSignals((n) => n + 1); } },
    row: (id: string, top: number, height: number) => { const old = rows.current.get(id); if (height > 0 && (old?.top !== top || old?.height !== height)) { rows.current.set(id, { top, height }); observation.current++; setSignals((n) => n + 1); } },
    text: (id: string) => { if (!texts.current.has(id)) { texts.current.add(id); setSignals((n) => n + 1); } },
    imageLoaded: () => setImageReady(true), imageFailed: () => setImageFailed(true),
    decorationReady: () => setDecorationReady(true),
  }), []);
  useEffect(() => {
    if (imageFailed) { callbacks.current.onError(noticeFailure('asset', document.template, new DomainError('notice', '原收款圖片未能載入，已停止生成。'))); return; }
    const doc = measured.current, body = content.current;
    if (started.current || !doc || !body || !imageReady || !decorationReady || rows.current.size !== document.items.length || texts.current.size !== Object.keys(noticeTextBlocks(document)).length ||
      footer.current.bottom <= 0 || Math.abs(footer.current.bottom + 20 * width / 360 - doc.height) > 2 || Math.abs(body.height - doc.height) > 1 || Math.abs(body.width - doc.width) > 1) return;
    started.current = true;
    void withNoticeCaptureSlot(async () => {
      let candidate: string | null = null; let stage: NoticeStage = 'layout';
      try {
        if (!mounted.current) return;
        prepare(); await frames(); const version = observation.current;
        if (!mounted.current || AppState.currentState !== 'active' || !scroll.current) throw new DomainError('render', '頁面不在前景，請重試預覽。');
        const node = scroll.current.getNativeScrollRef();
        if (!node) throw new DomainError('render', '捕獲容器尚未掛載。');
        const bounds = await new Promise<{ x: number; y: number; width: number; height: number }>((resolve, reject) => {
          const deadline = setTimeout(() => reject(new DomainError('render', '未能量度可見捕獲範圍，請重試。')), 2000);
          node.measureInWindow((x: number, y: number, w: number, h: number) => { clearTimeout(deadline); resolve({ x, y, width: w, height: h }); });
        });
        const window = Dimensions.get('window');
        if (bounds.width <= 0 || bounds.height <= 0 || bounds.x < -1 || bounds.y < -1 || bounds.x + bounds.width > window.width + 1 || bounds.y + bounds.height > window.height + 1) throw new DomainError('render', '通知捕獲區域未完整顯示，請返回前景後重試；不會假定隱藏視圖可正常擷取。');
        const plan = noticeCapturePlan(doc, PixelRatio.get());
        stage = 'capture';
        const { captureRef } = await import('react-native-view-shot'); const start = performance.now();
        candidate = await withNoticeCaptureDeadline(() => captureRef(scroll, { format: 'png', result: 'tmpfile', width: plan.width, height: plan.height, snapshotContentContainer: true, useRenderInContext: false }), releaseNoticeCapture);
        const captureMs = performance.now() - start;
        if (!mounted.current) return;
        stage = 'temp-file';
        if (!candidate.startsWith('file://')) candidate = `file://${candidate}`;
        const scale = 1080 / doc.width;
        const regions = document.items.map((item, n) => { const row = rows.current.get(item.id)!; return { label: tr`第 ${n + 1} 項商品`, top: (row.top + 2) * scale, bottom: (row.top + row.height - 2) * scale }; });
        regions.push({ label: tr("付款說明及頁尾"), top: (footer.current.top + 4) * scale, bottom: (footer.current.bottom - 2) * scale });
        stage = 'png-validation'; const actual = await inspectNoticePng(candidate, regions);
        stage = 'layout';
        if (!mounted.current || version !== observation.current || AppState.currentState !== 'active') throw new DomainError('render', '產生期間頁面或佈局改變，已丟棄結果。');
        if (actual.width !== plan.expectedWidth || Math.abs(actual.height - plan.expectedHeight) > 2) throw new DomainError('render', `PNG 尺寸不符：${actual.width} × ${actual.height} px，預期 1080 × ${plan.expectedHeight} px。未裁切內容，請回報此尺寸。`);
        callbacks.current.onReady({ uri: candidate, width: actual.width, height: actual.height, captureMs, template: document.template, identity: noticeRenderIdentity(document) }); candidate = null;
      } catch (cause) {
        if (mounted.current) callbacks.current.onError(noticeFailure(stage, document.template, cause));
      } finally { if (candidate) await releaseNoticeCapture(candidate); }
    });
  }, [signals, imageReady, decorationReady, imageFailed, document, width, prepare]);
  return <View style={{ flex: 1, minHeight: 80, backgroundColor: color.surface }}>
    <ScrollView ref={scroll} collapsable={false} nestedScrollEnabled removeClippedSubviews={false} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
      onContentSizeChange={(w, h) => { if (content.current?.width !== w || content.current?.height !== h) { content.current = { width: w, height: h }; observation.current++; setSignals((n) => n + 1); } }}>
      <NoticeRenderBoundary template={document.template} onError={onError}><NoticePaper document={document} width={width} observe={observe} /></NoticeRenderBoundary>
    </ScrollView><Text style={[e.caption, { padding: 8 }]}>{tr`正在準備圖片預覽，請保持此頁開啟。`}</Text>
  </View>;
}

class NoticeRenderBoundary extends Component<{ template: NoticeTemplate; children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(noticeFailure('template-render', this.props.template, error)); }
  render() { return this.state.failed ? <Text style={[e.error, { padding: 20 }]}>{tr`此模板未能繪製，請重試預覽。`}</Text> : this.props.children; }
}
