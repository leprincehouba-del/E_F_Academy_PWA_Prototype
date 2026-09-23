package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Build;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import androidx.graphics.lowlatency.LowLatencyCanvasView;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Zero-allocation front-buffer ink. Touch events publish primitive coordinates only.
 * The low-latency renderer draws just the new segments; page anchoring remains in DrawingView.
 */
public final class FrontBufferInkView extends FrameLayout {
  public interface StrokeListener { void onStrokeFinished(float[] points,int color,float width); }

  private static final int MAX_COORDS=131072;
  private final LowLatencyCanvasView canvasView;
  private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
  private final float[] points=new float[MAX_COORDS];
  private final AtomicBoolean frameQueued=new AtomicBoolean(false);
  private volatile int publishedCount=0;
  private volatile int renderedCount=0;
  private int pointCount=0;
  private volatile int strokeColor=Color.RED;
  private volatile float strokeWidth=5f;
  private int inkColor=Color.RED;
  private float inkWidth=5f,lastX,lastY;
  private boolean inputEnabled=false,drawing=false;
  private long generation=0;
  private StrokeListener listener;

  public FrontBufferInkView(Context context){
    super(context);
    setBackgroundColor(Color.TRANSPARENT);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeCap(Paint.Cap.ROUND);
    paint.setStrokeJoin(Paint.Join.ROUND);
    canvasView=new LowLatencyCanvasView(context);
    canvasView.setBackgroundColor(Color.TRANSPARENT);
    canvasView.setRenderCallback(new LowLatencyCanvasView.Callback(){
      @Override public void onDrawFrontBufferedLayer(Canvas canvas,int width,int height){
        int start=renderedCount;
        int end=publishedCount;
        drawRange(canvas,start,end);
        renderedCount=end;
        frameQueued.set(false);
        if(publishedCount>renderedCount)post(FrontBufferInkView.this::requestFrame);
      }
      @Override public void onRedrawRequested(Canvas canvas,int width,int height){
        drawRange(canvas,2,publishedCount);
      }
    });
    canvasView.setOnTouchListener((v,event)->handleTouch(event));
    addView(canvasView,new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT));
    canvasView.post(()->{canvasView.renderFrontBufferedLayer();canvasView.cancel();});
  }

  public void setStrokeListener(StrokeListener value){listener=value;}
  public void setInkColor(int value){inkColor=value;}
  public void setInkWidth(float value){inkWidth=Math.max(1f,value);}
  public void setInputEnabled(boolean value){
    if(!value)cancelActive();
    inputEnabled=value;canvasView.setClickable(value);canvasView.setEnabled(value);
  }
  public void clearInk(){cancelActive();}
  public boolean isFastRenderer(){return Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q;}

  private void drawRange(Canvas canvas,int start,int end){
    paint.setColor(strokeColor);
    paint.setStrokeWidth(strokeWidth);
    int first=Math.max(2,start);
    if((first&1)!=0)first++;
    for(int i=first;i+1<end;i+=2)
      canvas.drawLine(points[i-2],points[i-1],points[i],points[i+1],paint);
  }
  private void requestFrame(){
    if(frameQueued.compareAndSet(false,true))canvasView.renderFrontBufferedLayer();
  }
  private void resetStrokeBuffer(){
    pointCount=0;publishedCount=0;renderedCount=0;frameQueued.set(false);
  }
  private void appendPoint(float x,float y){
    if(pointCount+2>MAX_COORDS)return;
    if(pointCount>2&&x==lastX&&y==lastY)return;
    points[pointCount++]=x;points[pointCount++]=y;
    lastX=x;lastY=y;
    publishedCount=pointCount;
  }
  private float[] copyPoints(){
    float[] out=new float[pointCount];
    System.arraycopy(points,0,out,0,pointCount);
    return out;
  }
  private void cancelActive(){
    generation++;drawing=false;resetStrokeBuffer();canvasView.cancel();canvasView.clear();
  }
  private void finishStroke(){
    if(!drawing)return;
    drawing=false;
    final long completedGeneration=generation;
    float[] completed=pointCount>=4?copyPoints():null;
    if(completed!=null&&listener!=null)listener.onStrokeFinished(completed,strokeColor,strokeWidth);
    canvasView.commit();
    postDelayed(()->{
      if(!drawing&&generation==completedGeneration){
        resetStrokeBuffer();canvasView.clear();
      }
    },20L);
  }
  private boolean handleTouch(MotionEvent event){
    if(!inputEnabled)return false;
    switch(event.getActionMasked()){
      case MotionEvent.ACTION_DOWN:
        requestUnbufferedDispatch(event);
        canvasView.cancel();generation++;resetStrokeBuffer();
        strokeColor=inkColor;strokeWidth=inkWidth;lastX=event.getX();lastY=event.getY();
        appendPoint(lastX,lastY);drawing=true;appendPoint(lastX+.01f,lastY+.01f);requestFrame();return true;
      case MotionEvent.ACTION_MOVE:
        if(!drawing)return false;
        for(int i=0;i<event.getHistorySize();i++)appendPoint(event.getHistoricalX(i),event.getHistoricalY(i));
        appendPoint(event.getX(),event.getY());requestFrame();return true;
      case MotionEvent.ACTION_UP:
        if(!drawing)return false;
        appendPoint(event.getX(),event.getY());requestFrame();finishStroke();return true;
      case MotionEvent.ACTION_CANCEL:
        cancelActive();return true;
      default:return true;
    }
  }
}
