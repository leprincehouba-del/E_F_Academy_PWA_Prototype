package com.mrmohamed.teacherboard.nativeclean;

import android.content.Context;
import android.graphics.Color;
import android.view.MotionEvent;
import android.widget.FrameLayout;

import androidx.ink.authoring.InProgressStrokeId;
import androidx.ink.authoring.InProgressStrokesView;
import androidx.ink.brush.Brush;
import androidx.ink.brush.StockBrushes;
import androidx.input.motionprediction.MotionEventPredictor;

/**
 * A deliberately small wet-ink layer. It never converts a stroke to arrays or Paths while the
 * pointer is moving. Android Ink owns the complete live stroke and renders it in the front buffer.
 */
public final class NativeInkLayer extends FrameLayout {
    private final InProgressStrokesView ink;
    private final MotionEventPredictor predictor;
    private InProgressStrokeId activeStroke;
    private int activePointer = -1;
    private int color = Color.RED;
    private float width = 5f;
    private boolean drawingEnabled;

    public NativeInkLayer(Context context) {
        super(context);
        setBackgroundColor(Color.TRANSPARENT);
        setWillNotDraw(true);

        ink = new InProgressStrokesView(context);
        ink.setBackgroundColor(Color.TRANSPARENT);
        predictor = MotionEventPredictor.newInstance(ink);
        ink.setOnTouchListener((view, event) -> consume(event));
        addView(ink, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        // Avoid the expensive JNI/renderer initialization on the teacher's first pen-down.
        ink.post(ink::eagerInit);
        setDrawingEnabled(false);
    }

    public void setDrawingEnabled(boolean enabled) {
        if (!enabled) cancelActive();
        drawingEnabled = enabled;
        ink.setEnabled(enabled);
        ink.setClickable(enabled);
    }

    public void setPenColor(int value) { color = value; }
    public void setPenWidth(float value) { width = Math.max(1f, value); }

    public void undo() {
        java.util.Map<InProgressStrokeId, androidx.ink.strokes.Stroke> strokes = ink.getFinishedStrokes();
        if (strokes.isEmpty()) return;
        InProgressStrokeId last = null;
        for (InProgressStrokeId id : strokes.keySet()) last = id;
        if (last != null) ink.removeFinishedStrokes(java.util.Collections.singleton(last));
    }

    public void clear() {
        cancelActive();
        java.util.Map<InProgressStrokeId, androidx.ink.strokes.Stroke> strokes = ink.getFinishedStrokes();
        if (!strokes.isEmpty()) ink.removeFinishedStrokes(new java.util.HashSet<>(strokes.keySet()));
    }

    private Brush brush() {
        return Brush.createWithColorIntArgb(StockBrushes.marker(), color, width, 0.1f);
    }

    private boolean consume(MotionEvent event) {
        if (!drawingEnabled) return false;
        predictor.record(event);
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                ink.requestUnbufferedDispatch(event);
                activePointer = event.getPointerId(event.getActionIndex());
                activeStroke = ink.startStroke(event, activePointer, brush());
                return true;
            case MotionEvent.ACTION_MOVE:
                if (activeStroke == null) return false;
                MotionEvent predicted = null;
                try {
                    predicted = predictor.predict();
                    ink.addToStroke(event, activePointer, activeStroke, predicted);
                } finally {
                    if (predicted != null) predicted.recycle();
                }
                return true;
            case MotionEvent.ACTION_UP:
                if (activeStroke == null) return false;
                ink.finishStroke(event, activePointer, activeStroke);
                activeStroke = null;
                activePointer = -1;
                return true;
            case MotionEvent.ACTION_CANCEL:
                cancelActive();
                return true;
            default:
                return true;
        }
    }

    private void cancelActive() {
        if (activeStroke != null) ink.cancelStroke(activeStroke);
        activeStroke = null;
        activePointer = -1;
        ink.cancelUnfinishedStrokes();
    }
}
