package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.Color;
import android.os.Build;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import androidx.ink.authoring.InProgressStrokeId;
import androidx.ink.authoring.InProgressStrokesFinishedListener;
import androidx.ink.authoring.InProgressStrokesView;
import androidx.ink.brush.Brush;
import androidx.ink.brush.StockBrushes;
import androidx.input.motionprediction.MotionEventPredictor;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

/**
 * Live-ink-only layer. Finished strokes are immediately handed to DrawingView, which remains the
 * single source of truth for page anchoring, undo/redo, erasing and PDF transforms.
 */
public final class FrontBufferInkView extends FrameLayout {
  public interface StrokeListener { void onStrokeFinished(float[] points,int color,float width); }
  private static final class FinishedStroke {
    final float[] points; final int color; final float width;
    FinishedStroke(float[] p,int c,float w){points=p;color=c;width=w;}
  }

  private final InProgressStrokesView inkView;
  private final MotionEventPredictor predictor;
  // Reused primitive buffer: no Float boxing or per-point allocation while the pen moves.
  private float[] points=new float[16384];
  private int pointCount=0;
  private final Map<InProgressStrokeId,FinishedStroke> waiting=new HashMap<>();
  private InProgressStrokeId activeStroke;
  private int activePointerId=-1;
  private int inkColor=Color.RED,strokeColor=Color.RED;
  private float inkWidth=5f,strokeWidth=5f;
  private boolean inputEnabled=false;
  private StrokeListener listener;

  public FrontBufferInkView(Context context){
    super(context);setBackgroundColor(Color.TRANSPARENT);
    inkView=new InProgressStrokesView(context);inkView.setBackgroundColor(Color.TRANSPARENT);
    predictor=MotionEventPredictor.newInstance(inkView);
    inkView.addFinishedStrokesListener(new InProgressStrokesFinishedListener(){
      @Override public void onStrokesFinished(Map<InProgressStrokeId,androidx.ink.strokes.Stroke> strokes){
        for(InProgressStrokeId id:strokes.keySet()){
          FinishedStroke done=waiting.remove(id);
          if(done!=null&&listener!=null)listener.onStrokeFinished(done.points,done.color,done.width);
        }
        if(!strokes.isEmpty())inkView.removeFinishedStrokes(new HashSet<>(strokes.keySet()));
      }
    });
    inkView.setOnTouchListener((v,e)->handleTouch(e));
    addView(inkView,new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT));
    inkView.post(inkView::eagerInit);
  }

  public void setStrokeListener(StrokeListener value){listener=value;}
  public void setInkColor(int value){inkColor=value;}
  public void setInkWidth(float value){inkWidth=Math.max(1f,value);}
  public void setInputEnabled(boolean value){
    if(!value)cancelActive();inputEnabled=value;inkView.setClickable(value);inkView.setEnabled(value);
  }
  public void clearInk(){
    cancelActive();waiting.clear();points.clear();
    Map<InProgressStrokeId,androidx.ink.strokes.Stroke> finished=inkView.getFinishedStrokes();
    if(!finished.isEmpty())inkView.removeFinishedStrokes(new HashSet<>(finished.keySet()));
  }
  public boolean isFastRenderer(){return Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q;}

  private Brush newBrush(){return Brush.createWithColorIntArgb(StockBrushes.marker(),strokeColor,strokeWidth,.1f);}
  private void appendPoint(float x,float y){
    if(pointCount+2>points.length){
      float[] grown=new float[points.length*2];
      System.arraycopy(points,0,grown,0,pointCount);
      points=grown;
    }
    points[pointCount++]=x;
    points[pointCount++]=y;
  }
  private void appendEventPoints(MotionEvent e,boolean includeHistory){
    if(includeHistory)for(int i=0;i<e.getHistorySize();i++)appendPoint(e.getHistoricalX(i),e.getHistoricalY(i));
    appendPoint(e.getX(),e.getY());
  }
  private float[] copyPoints(){
    float[] out=new float[pointCount];
    System.arraycopy(points,0,out,0,pointCount);
    return out;
  }
  private void cancelActive(){
    if(activeStroke!=null){inkView.cancelStroke(activeStroke);activeStroke=null;}
    activePointerId=-1;points.clear();inkView.cancelUnfinishedStrokes();
  }
  private boolean handleTouch(MotionEvent e){
    if(!inputEnabled)return false;predictor.record(e);
    switch(e.getActionMasked()){
      case MotionEvent.ACTION_DOWN:
        inkView.requestUnbufferedDispatch(e);points.clear();appendEventPoints(e,false);
        strokeColor=inkColor;strokeWidth=inkWidth;activePointerId=e.getPointerId(e.getActionIndex());
        activeStroke=inkView.startStroke(e,activePointerId,newBrush());return true;
      case MotionEvent.ACTION_MOVE:
        if(activeStroke==null)return false;appendEventPoints(e,true);MotionEvent prediction=null;
        try{prediction=predictor.predict();inkView.addToStroke(e,activePointerId,activeStroke,prediction);}
        finally{if(prediction!=null)prediction.recycle();}return true;
      case MotionEvent.ACTION_UP:
        if(activeStroke==null)return false;appendEventPoints(e,false);
        InProgressStrokeId finishedId=activeStroke;waiting.put(finishedId,new FinishedStroke(copyPoints(),strokeColor,strokeWidth));
        inkView.finishStroke(e,activePointerId,finishedId);activeStroke=null;activePointerId=-1;points.clear();return true;
      case MotionEvent.ACTION_CANCEL:
        if(activeStroke!=null)inkView.cancelStroke(activeStroke,e);activeStroke=null;activePointerId=-1;points.clear();return true;
      default:return true;
    }
  }
}
