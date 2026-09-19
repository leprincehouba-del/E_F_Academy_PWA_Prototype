package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.util.AttributeSet;
import android.util.LruCache;
import android.view.GestureDetector;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.widget.OverScroller;

import java.io.IOException;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ContinuousPdfView extends View {
    public interface PageListener {
        void onPageChanged(int pageNumber, int pageCount);
    }

    public interface OpenListener {
        void onOpened(Throwable error);
    }

    private static final float MIN_ZOOM = 0.65f;
    private static final float MAX_ZOOM = 4.0f;
    private static final int MAX_RENDER_EDGE = 2400;
    private static final int MAX_RENDER_PIXELS = 4_000_000;
    private static final int PREVIEW_RENDER_EDGE = 1050;
    private static final int PREVIEW_RENDER_PIXELS = 1_350_000;
    private static final long SHARP_RENDER_IDLE_MS = 220L;

    private final Paint bitmapPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint placeholderPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint pageNumberPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final ExecutorService renderExecutor = Executors.newSingleThreadExecutor();
    private final Set<String> pendingRenders = Collections.synchronizedSet(new HashSet<>());
    private final OverScroller scroller;
    private final GestureDetector gestureDetector;
    private final ScaleGestureDetector scaleDetector;
    private final LruCache<Integer, Bitmap> pageCache;

    private ParcelFileDescriptor descriptor;
    private PdfRenderer renderer;
    private PageListener pageListener;
    private int generation = 0;
    private int pageCount = 0;
    private int lastReportedPage = -1;
    private float sourceAspect = 1.4142f;
    private float zoom = 1f;
    private float scrollYpx = 0f;
    private int pageGapPx;
    private long lastInteractionMs;

    public ContinuousPdfView(Context context) {
        this(context, null);
    }

    public ContinuousPdfView(Context context, AttributeSet attrs) {
        super(context, attrs);
        setBackgroundColor(Color.rgb(51, 76, 72));
        pageGapPx = dp(14);
        placeholderPaint.setColor(Color.rgb(232, 236, 235));
        pageNumberPaint.setColor(Color.rgb(75, 92, 89));
        pageNumberPaint.setTextSize(dp(16));
        pageNumberPaint.setTextAlign(Paint.Align.CENTER);
        scroller = new OverScroller(context);

        int maxCacheKb = (int) Math.min(
            192L * 1024L,
            Runtime.getRuntime().maxMemory() / 1024L / 5L
        );
        pageCache = new LruCache<Integer, Bitmap>(Math.max(24 * 1024, maxCacheKb)) {
            @Override
            protected int sizeOf(Integer key, Bitmap bitmap) {
                return Math.max(1, bitmap.getAllocationByteCount() / 1024);
            }

            @Override
            protected void entryRemoved(boolean evicted, Integer key, Bitmap oldValue, Bitmap newValue) {
                if (oldValue != newValue && oldValue != null && !oldValue.isRecycled()) {
                    oldValue.recycle();
                }
            }
        };

        gestureDetector = new GestureDetector(context, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent event) {
                scroller.forceFinished(true);
                return true;
            }

            @Override
            public boolean onScroll(MotionEvent first, MotionEvent current, float distanceX, float distanceY) {
                if (scaleDetector.isInProgress()) return false;
                setScrollPosition(scrollYpx + distanceY);
                return true;
            }

            @Override
            public boolean onFling(MotionEvent first, MotionEvent current, float velocityX, float velocityY) {
                scroller.fling(
                    0,
                    Math.round(scrollYpx),
                    0,
                    Math.round(-velocityY),
                    0,
                    0,
                    0,
                    Math.round(maxScroll())
                );
                postInvalidateOnAnimation();
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent event) {
                float target = zoom > 1.25f ? 1f : 1.8f;
                setZoomAround(target, event.getX(), event.getY());
                return true;
            }
        });

        scaleDetector = new ScaleGestureDetector(context, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override
            public boolean onScale(ScaleGestureDetector detector) {
                setZoomAround(
                    zoom * detector.getScaleFactor(),
                    detector.getFocusX(),
                    detector.getFocusY()
                );
                return true;
            }
        });
    }

    public void setPageListener(PageListener listener) {
        pageListener = listener;
    }

    public void open(Uri uri, OpenListener listener) {
        final int openGeneration = ++generation;
        pendingRenders.clear();
        recycleCache();
        pageCount = 0;
        scrollYpx = 0;
        invalidate();

        renderExecutor.execute(() -> {
            closeRendererOnWorker();
            Throwable failure = null;
            int count = 0;
            float aspect = 1.4142f;
            try {
                descriptor = getContext().getContentResolver().openFileDescriptor(uri, "r");
                if (descriptor == null) throw new IOException("PDF descriptor unavailable");
                renderer = new PdfRenderer(descriptor);
                count = renderer.getPageCount();
                if (count < 1) throw new IOException("PDF contains no pages");
                try (PdfRenderer.Page firstPage = renderer.openPage(0)) {
                    aspect = (float) firstPage.getHeight() / Math.max(1, firstPage.getWidth());
                }
            } catch (Throwable error) {
                failure = error;
                closeRendererOnWorker();
            }

            final Throwable resultError = failure;
            final int resultCount = count;
            final float resultAspect = aspect;
            post(() -> {
                if (openGeneration != generation) return;
                if (resultError == null) {
                    pageCount = resultCount;
                    sourceAspect = resultAspect;
                    zoom = 1f;
                    scrollYpx = 0f;
                    lastInteractionMs = SystemClock.uptimeMillis();
                    lastReportedPage = -1;
                    invalidate();
                    postInvalidateDelayed(SHARP_RENDER_IDLE_MS + 30L);
                    reportCurrentPage();
                }
                if (listener != null) listener.onOpened(resultError);
            });
        });
    }

    public void fitWidth() {
        setZoomAround(1f, getWidth() / 2f, getHeight() / 2f);
    }

    public void zoomBy(float factor) {
        setZoomAround(zoom * factor, getWidth() / 2f, getHeight() / 2f);
    }

    private void setZoomAround(float requestedZoom, float focusX, float focusY) {
        float nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requestedZoom));
        if (Math.abs(nextZoom - zoom) < 0.001f) return;
        float oldZoom = zoom;
        float contentAnchor = (scrollYpx + focusY) / oldZoom;
        zoom = nextZoom;
        scrollYpx = contentAnchor * nextZoom - focusY;
        clampScroll();
        invalidate();
        reportCurrentPage();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (pageCount < 1 || getWidth() < 1 || getHeight() < 1) return;

        float pageWidth = basePageWidth() * zoom;
        float pageHeight = pageWidth * sourceAspect;
        float stride = pageHeight + pageGapPx;
        int firstVisible = Math.max(0, (int) Math.floor(scrollYpx / stride));
        int lastVisible = Math.min(
            pageCount - 1,
            (int) Math.ceil((scrollYpx + getHeight()) / stride)
        );

        int drawStart = Math.max(0, firstVisible - 1);
        int drawEnd = Math.min(pageCount - 1, lastVisible + 1);
        for (int pageIndex = drawStart; pageIndex <= drawEnd; pageIndex++) {
            float left = (getWidth() - pageWidth) / 2f;
            float top = pageGapPx + pageIndex * stride - scrollYpx;
            Rect destination = new Rect(
                Math.round(left),
                Math.round(top),
                Math.round(left + pageWidth),
                Math.round(top + pageHeight)
            );
            Bitmap bitmap = pageCache.get(pageIndex);
            if (bitmap != null && !bitmap.isRecycled()) {
                canvas.drawBitmap(bitmap, null, destination, bitmapPaint);
            } else {
                canvas.drawRect(destination, placeholderPaint);
                float textY = destination.centerY() -
                    (pageNumberPaint.ascent() + pageNumberPaint.descent()) / 2f;
                canvas.drawText("Page " + (pageIndex + 1), destination.centerX(), textY, pageNumberPaint);
            }
        }

        // Always request a quick preview for visible pages first. This keeps a fast
        // swipe from reaching a completely blank page on lower-powered boards.
        for (int pageIndex = firstVisible; pageIndex <= lastVisible; pageIndex++) {
            scheduleRender(pageIndex, pageWidth, true);
        }

        // Prepare nearby pages while the current page is being read. Keeping this
        // window small avoids filling the cache with a whole 500-page book.
        int prefetchStart = Math.max(0, firstVisible - 2);
        int prefetchEnd = Math.min(pageCount - 1, lastVisible + 4);
        for (int pageIndex = prefetchStart; pageIndex <= prefetchEnd; pageIndex++) {
            if (pageIndex < firstVisible || pageIndex > lastVisible) {
                scheduleRender(pageIndex, pageWidth, true);
            }
        }

        // Only spend time on the sharp render after the hand/fling has stopped.
        // This prevents old high-resolution work from blocking the next page.
        boolean idle = scroller.isFinished() &&
            SystemClock.uptimeMillis() - lastInteractionMs >= SHARP_RENDER_IDLE_MS;
        if (idle) {
            for (int pageIndex = firstVisible; pageIndex <= lastVisible; pageIndex++) {
                scheduleRender(pageIndex, pageWidth, false);
            }
        }
        reportCurrentPage();
    }

    private void scheduleRender(int pageIndex, float displayWidth, boolean preview) {
        if (renderer == null || pageIndex < 0 || pageIndex >= pageCount) return;
        final int renderGeneration = generation;
        int edgeLimit = preview ? PREVIEW_RENDER_EDGE : MAX_RENDER_EDGE;
        int pixelLimit = preview ? PREVIEW_RENDER_PIXELS : MAX_RENDER_PIXELS;
        int requestedWidth = Math.max(1, Math.min(edgeLimit, Math.round(displayWidth)));
        int requestedHeight = Math.max(1, Math.round(requestedWidth * sourceAspect));
        if ((long) requestedWidth * requestedHeight > pixelLimit) {
            float safeScale = (float) Math.sqrt(
                pixelLimit / ((double) requestedWidth * requestedHeight)
            );
            requestedWidth = Math.max(1, Math.round(requestedWidth * safeScale));
            requestedHeight = Math.max(1, Math.round(requestedHeight * safeScale));
        }
        final int targetWidth = requestedWidth;
        final int targetHeight = requestedHeight;
        Bitmap cached = pageCache.get(pageIndex);
        if (cached != null && !cached.isRecycled() && cached.getWidth() >= targetWidth) return;
        final String pendingKey = pageIndex + ":" + targetWidth;
        if (!pendingRenders.add(pendingKey)) return;

        renderExecutor.execute(() -> {
            Bitmap bitmap = null;
            try {
                if (renderGeneration != generation || renderer == null) return;
                try (PdfRenderer.Page page = renderer.openPage(pageIndex)) {
                    bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
                    bitmap.eraseColor(Color.WHITE);
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
                }
            } catch (Throwable error) {
                if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
                bitmap = null;
            } finally {
                final Bitmap rendered = bitmap;
                post(() -> {
                    pendingRenders.remove(pendingKey);
                    if (renderGeneration != generation) {
                        if (rendered != null && !rendered.isRecycled()) rendered.recycle();
                        return;
                    }
                    if (rendered != null) {
                        Bitmap current = pageCache.get(pageIndex);
                        if (current == null || current.isRecycled() ||
                            current.getWidth() < rendered.getWidth()) {
                            pageCache.put(pageIndex, rendered);
                        } else if (!rendered.isRecycled()) {
                            rendered.recycle();
                        }
                        invalidate();
                    }
                });
            }
        });
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        lastInteractionMs = SystemClock.uptimeMillis();
        scaleDetector.onTouchEvent(event);
        gestureDetector.onTouchEvent(event);
        if (event.getActionMasked() == MotionEvent.ACTION_UP ||
            event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
            performClick();
            postInvalidateDelayed(SHARP_RENDER_IDLE_MS + 30L);
        }
        return true;
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }

    @Override
    public void computeScroll() {
        if (scroller.computeScrollOffset()) {
            scrollYpx = scroller.getCurrY();
            clampScroll();
            reportCurrentPage();
            postInvalidateOnAnimation();
        }
    }

    private void setScrollPosition(float value) {
        scrollYpx = value;
        clampScroll();
        reportCurrentPage();
        invalidate();
    }

    private void clampScroll() {
        scrollYpx = Math.max(0f, Math.min(maxScroll(), scrollYpx));
    }

    private float maxScroll() {
        if (pageCount < 1) return 0f;
        float pageHeight = basePageWidth() * zoom * sourceAspect;
        float documentHeight = pageGapPx + pageCount * (pageHeight + pageGapPx);
        return Math.max(0f, documentHeight - getHeight());
    }

    private float basePageWidth() {
        return Math.max(dp(240), getWidth() - dp(32));
    }

    private void reportCurrentPage() {
        if (pageListener == null || pageCount < 1) return;
        float pageHeight = basePageWidth() * zoom * sourceAspect;
        float stride = pageHeight + pageGapPx;
        int page = Math.max(0, Math.min(
            pageCount - 1,
            Math.round((scrollYpx + getHeight() / 2f) / stride)
        ));
        if (page == lastReportedPage) return;
        lastReportedPage = page;
        pageListener.onPageChanged(page + 1, pageCount);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void recycleCache() {
        pageCache.evictAll();
    }

    public void release() {
        generation += 1;
        pendingRenders.clear();
        recycleCache();
        renderExecutor.execute(this::closeRendererOnWorker);
        renderExecutor.shutdown();
    }

    private void closeRendererOnWorker() {
        if (renderer != null) {
            try {
                renderer.close();
            } catch (Throwable ignored) {
            }
            renderer = null;
        }
        if (descriptor != null) {
            try {
                descriptor.close();
            } catch (IOException ignored) {
            }
            descriptor = null;
        }
    }
}
