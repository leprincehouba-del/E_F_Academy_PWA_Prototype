package com.mrmohamed.teacherboard.nativeclean;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.SystemClock;
import android.view.MotionEvent;

import androidx.graphics.lowlatency.LowLatencyCanvasView;

import java.util.ArrayList;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Android's lowest-latency public Canvas path. Moving ink is written into a front buffer that is
 * submitted directly to SurfaceFlinger, then committed into the normal View hierarchy on pen-up.
 */
public final class FrontBufferInkView extends LowLatencyCanvasView {
    private static final class Line {
        final float x1, y1, x2, y2, width;
        final int color;
        Line(float x1, float y1, float x2, float y2, float width, int color) {
            this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
            this.width = width; this.color = color;
        }
    }

    private final ConcurrentLinkedQueue<Line> pending = new ConcurrentLinkedQueue<>();
    // Accessed only by LowLatencyCanvasView's render thread.
    private final ArrayList<Line> allLines = new ArrayList<>();
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
    private boolean drawingEnabled;
    private int color = Color.RED;
    private float width = 5f;
    private float lastX, lastY;
    private boolean strokeActive;
    private NativeInkLayer.DiagnosticsListener diagnosticsListener;
    private long statsStartedAt;
    private int statsSamples;

    public FrontBufferInkView(Context context) {
        super(context, null, 0);
        setBackgroundColor(Color.TRANSPARENT);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        setRenderCallback(new Callback() {
            @Override public void onDrawFrontBufferedLayer(Canvas canvas, int w, int h) {
                Line line;
                while ((line = pending.poll()) != null) {
                    allLines.add(line);
                    drawLine(canvas, line);
                }
            }

            @Override public void onRedrawRequested(Canvas canvas, int w, int h) {
                for (int i = 0, size = allLines.size(); i < size; i++) drawLine(canvas, allLines.get(i));
            }
        });
        setDrawingEnabled(false);
    }

    public void setDrawingEnabled(boolean enabled) {
        drawingEnabled = enabled;
        setEnabled(enabled);
        setClickable(enabled);
        if (!enabled && strokeActive) {
            strokeActive = false;
            commit();
        }
    }

    public void setPenColor(int value) { color = value; }
    public void setPenWidth(float value) { width = Math.max(1f, value); }
    public void setDiagnosticsListener(NativeInkLayer.DiagnosticsListener value) { diagnosticsListener = value; }

    public void clearInk() {
        strokeActive = false;
        pending.clear();
        execute(allLines::clear);
        clear();
    }

    public void undo() {
        // This test deliberately measures the live front-buffer path. Clear is deterministic while
        // undo would require rebuilding stroke groups and would contaminate the latency comparison.
        clearInk();
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (!drawingEnabled) return false;
        recordStats(event);
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                requestUnbufferedDispatch(event);
                lastX = event.getX();
                lastY = event.getY();
                strokeActive = true;
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!strokeActive) return false;
                for (int i = 0; i < event.getHistorySize(); i++) {
                    append(lastX, lastY, event.getHistoricalX(i), event.getHistoricalY(i));
                    lastX = event.getHistoricalX(i);
                    lastY = event.getHistoricalY(i);
                }
                append(lastX, lastY, event.getX(), event.getY());
                lastX = event.getX();
                lastY = event.getY();
                renderFrontBufferedLayer();
                return true;
            case MotionEvent.ACTION_UP:
                if (!strokeActive) return false;
                append(lastX, lastY, event.getX(), event.getY());
                renderFrontBufferedLayer();
                strokeActive = false;
                commit();
                return true;
            case MotionEvent.ACTION_CANCEL:
                pending.clear();
                strokeActive = false;
                cancel();
                return true;
            default:
                return true;
        }
    }

    private void append(float x1, float y1, float x2, float y2) {
        if (x1 == x2 && y1 == y2) return;
        pending.add(new Line(x1, y1, x2, y2, width, color));
    }

    private void drawLine(Canvas canvas, Line line) {
        paint.setColor(line.color);
        paint.setStrokeWidth(line.width);
        canvas.drawLine(line.x1, line.y1, line.x2, line.y2, paint);
    }

    private void recordStats(MotionEvent event) {
        long now = SystemClock.uptimeMillis();
        if (statsStartedAt == 0L) statsStartedAt = now;
        statsSamples += Math.max(1, event.getHistorySize() + 1);
        long elapsed = now - statsStartedAt;
        if (elapsed < 300L || diagnosticsListener == null) return;
        int hz = Math.round(statsSamples * 1000f / Math.max(1L, elapsed));
        int index = Math.max(0, Math.min(event.getActionIndex(), event.getPointerCount() - 1));
        int toolType = event.getToolType(index);
        String tool = toolType == MotionEvent.TOOL_TYPE_STYLUS ? "قلم"
            : toolType == MotionEvent.TOOL_TYPE_ERASER ? "ممحاة"
            : toolType == MotionEvent.TOOL_TYPE_FINGER ? "إصبع" : "أخرى";
        diagnosticsListener.onInputStats("Front Buffer", tool, hz, Math.max(0L, now - event.getEventTime()));
        statsStartedAt = now;
        statsSamples = 0;
    }
}
