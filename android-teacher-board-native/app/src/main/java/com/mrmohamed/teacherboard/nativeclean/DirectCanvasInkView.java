package com.mrmohamed.teacherboard.nativeclean;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;

import java.util.ArrayList;

/**
 * Simple hardware Canvas baseline. It intentionally avoids prediction, JNI and front-buffer APIs.
 * Comparing it with Android Ink separates a renderer problem from a slow device input stream.
 */
public final class DirectCanvasInkView extends View {
    private static final class Stroke {
        final Path path;
        final Paint paint;
        Stroke(Path path, Paint paint) { this.path = path; this.paint = paint; }
    }

    private final ArrayList<Stroke> strokes = new ArrayList<>();
    private Path currentPath;
    private Paint currentPaint;
    private boolean drawingEnabled;
    private int color = Color.RED;
    private float width = 5f;
    private NativeInkLayer.DiagnosticsListener diagnosticsListener;
    private long statsStartedAt;
    private int statsSamples;

    public DirectCanvasInkView(Context context) {
        super(context);
        setBackgroundColor(Color.TRANSPARENT);
        setLayerType(View.LAYER_TYPE_HARDWARE, null);
    }

    public void setDrawingEnabled(boolean enabled) {
        drawingEnabled = enabled;
        setEnabled(enabled);
        setClickable(enabled);
        if (!enabled) currentPath = null;
    }

    public void setPenColor(int value) { color = value; }
    public void setPenWidth(float value) { width = Math.max(1f, value); }
    public void setDiagnosticsListener(NativeInkLayer.DiagnosticsListener value) { diagnosticsListener = value; }

    public void undo() {
        if (!strokes.isEmpty()) {
            strokes.remove(strokes.size() - 1);
            invalidate();
        }
    }

    public void clear() {
        strokes.clear();
        currentPath = null;
        invalidate();
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        for (int i = 0, size = strokes.size(); i < size; i++) {
            Stroke stroke = strokes.get(i);
            canvas.drawPath(stroke.path, stroke.paint);
        }
        if (currentPath != null && currentPaint != null) canvas.drawPath(currentPath, currentPaint);
    }

    @Override public boolean onTouchEvent(MotionEvent event) {
        if (!drawingEnabled) return false;
        recordStats(event);
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                requestUnbufferedDispatch(event);
                currentPath = new Path();
                currentPath.moveTo(event.getX(), event.getY());
                currentPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
                currentPaint.setColor(color);
                currentPaint.setStyle(Paint.Style.STROKE);
                currentPaint.setStrokeCap(Paint.Cap.ROUND);
                currentPaint.setStrokeJoin(Paint.Join.ROUND);
                currentPaint.setStrokeWidth(width);
                invalidate();
                return true;
            case MotionEvent.ACTION_MOVE:
                if (currentPath == null) return false;
                for (int i = 0; i < event.getHistorySize(); i++) {
                    currentPath.lineTo(event.getHistoricalX(i), event.getHistoricalY(i));
                }
                currentPath.lineTo(event.getX(), event.getY());
                postInvalidateOnAnimation();
                return true;
            case MotionEvent.ACTION_UP:
                if (currentPath == null) return false;
                currentPath.lineTo(event.getX(), event.getY());
                strokes.add(new Stroke(currentPath, currentPaint));
                currentPath = null;
                currentPaint = null;
                invalidate();
                return true;
            case MotionEvent.ACTION_CANCEL:
                currentPath = null;
                currentPaint = null;
                invalidate();
                return true;
            default:
                return true;
        }
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
        diagnosticsListener.onInputStats("Canvas مباشر", tool, hz, Math.max(0L, now - event.getEventTime()));
        statsStartedAt = now;
        statsSamples = 0;
    }
}
