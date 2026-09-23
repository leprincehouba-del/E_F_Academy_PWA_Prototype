package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Build;
import android.view.MotionEvent;
import android.view.View;
import androidx.input.motionprediction.MotionEventPredictor;

/**
 * Direct hardware ink with motion prediction.
 * Actual samples are committed; predicted samples are display-only.
 */
public final class FrontBufferInkView extends View {
  public interface StrokeListener { void onStrokeFinished(float[] points,int color,float width); }

  private static final int INITIAL_COORDS=16384;
  private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path livePath=new Path();
  private final Path predictedPath=new Path();
  private final MotionEventPredictor predictor;
  private float[] points=new float[INITIAL_COORDS];
  private int pointCount=0,activePointerId=MotionEvent.INVALID_POINTER_ID;
  private int inkColor=Color.RED,strokeColor=Color.RED;
  private float inkWidth=5f,strokeWidth=5f,lastX,lastY;
  private boolean inputEnabled=false,drawing=false;
  private StrokeListener listener;

  public FrontBufferInkView(Context context){
    super(context);
    setBackgroundColor(Color.TRANSPARENT);
    setWillNotDraw(false);
    setLayerType(View.LAYER_TYPE_HARDWARE,null);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeCap(Paint.Cap.ROUND);
    paint.setStrokeJoin(Paint.Join.ROUND);
    predictor=MotionEventPredictor.newInstance(this);
  }

  public void setStrokeListener(StrokeListener value){listener=value;}
  public void setInkColor(int value){inkColor=value;}
  public void setInkWidth(float value){inkWidth=Math.max(1f,value);}
  public void setInputEnabled(boolean value){
    if(!value)cancelActive();
    inputEnabled=value;setClickable(value);setEnabled(value);
  }
  public void clearInk(){cancelActive();}
  public boolean isFastRenderer(){return Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q;}

  @Override protected void onDraw(Canvas canvas){
    super.onDraw(canvas);
    if(!drawing)return;
    paint.setColor(strokeColor);
    paint.setStrokeWidth(strokeWidth);
    canvas.drawPath(livePath,paint);
    if(!predictedPath.isEmpty())canvas.drawPath(predictedPath,paint);
  }

  private void ensureCapacity(int needed){
    if(needed<=points.length)return;
    int size=Math.max(needed,points.length*2);
    float[] grown=new float[size];
    System.arraycopy(points,0,grown,0,pointCount);
    points=grown;
  }
  private void appendActual(float x,float y){
    if(pointCount>=2&&x==lastX&&y==lastY)return;
    ensureCapacity(pointCount+2);
    if(pointCount==0)livePath.moveTo(x,y);else livePath.lineTo(x,y);
    points[pointCount++]=x;points[pointCount++]=y;
    lastX=x;lastY=y;
  }
  private void updatePrediction(){
    predictedPath.reset();
    if(!drawing||pointCount<2)return;
    MotionEvent prediction=predictor.predict();
    if(prediction==null)return;
    try{
      int index=prediction.findPointerIndex(activePointerId);
      if(index<0)return;
      predictedPath.moveTo(lastX,lastY);
      for(int i=0;i<prediction.getHistorySize();i++)
        predictedPath.lineTo(prediction.getHistoricalX(index,i),prediction.getHistoricalY(index,i));
      predictedPath.lineTo(prediction.getX(index),prediction.getY(index));
    }finally{prediction.recycle();}
  }
  private void record(MotionEvent event){
    try{predictor.record(event);}catch(IllegalArgumentException ignored){}
  }
  private float[] copyPoints(){
    float[] out=new float[pointCount];
    System.arraycopy(points,0,out,0,pointCount);
    return out;
  }
  private void cancelActive(){
    drawing=false;activePointerId=MotionEvent.INVALID_POINTER_ID;pointCount=0;
    livePath.reset();predictedPath.reset();invalidate();
  }
  private void finishStroke(){
    if(!drawing)return;
    float[] completed=pointCount>=4?copyPoints():null;
    int color=strokeColor;float width=strokeWidth;
    drawing=false;activePointerId=MotionEvent.INVALID_POINTER_ID;pointCount=0;
    livePath.reset();predictedPath.reset();
    if(completed!=null&&listener!=null)listener.onStrokeFinished(completed,color,width);
    invalidate();
  }

  @Override public boolean onTouchEvent(MotionEvent event){
    if(!inputEnabled)return false;
    record(event);
    switch(event.getActionMasked()){
      case MotionEvent.ACTION_DOWN:
        requestUnbufferedDispatch(event);
        livePath.reset();predictedPath.reset();pointCount=0;
        activePointerId=event.getPointerId(0);
        strokeColor=inkColor;strokeWidth=inkWidth;drawing=true;
        appendActual(event.getX(0),event.getY(0));invalidate();return true;
      case MotionEvent.ACTION_MOVE:
        if(!drawing)return false;
        int index=event.findPointerIndex(activePointerId);
        if(index<0)return true;
        for(int i=0;i<event.getHistorySize();i++)
          appendActual(event.getHistoricalX(index,i),event.getHistoricalY(index,i));
        appendActual(event.getX(index),event.getY(index));
        updatePrediction();invalidate();return true;
      case MotionEvent.ACTION_UP:
        if(!drawing)return false;
        int upIndex=event.findPointerIndex(activePointerId);
        if(upIndex>=0)appendActual(event.getX(upIndex),event.getY(upIndex));
        finishStroke();return true;
      case MotionEvent.ACTION_CANCEL:
        cancelActive();return true;
      default:return true;
    }
  }
}
