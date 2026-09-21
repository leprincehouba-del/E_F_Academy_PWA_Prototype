package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.view.MotionEvent;
import android.view.View;

/**
 * Direct live-ink overlay. Motion samples go straight into one hardware-drawn Path.
 * No queues, worker callbacks, front buffers, motion predictors or per-point objects are used.
 * The completed primitive point array is handed to DrawingView only after ACTION_UP.
 */
public final class FrontBufferInkView extends View {
  public interface StrokeListener { void onStrokeFinished(float[] points,int color,float width); }

  private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
  private final Path livePath=new Path();
  private float[] points=new float[16384];
  private int pointCount=0;
  private int inkColor=Color.RED,strokeColor=Color.RED;
  private float inkWidth=5f,strokeWidth=5f,lastX,lastY;
  private float strokeMinX,strokeMinY,strokeMaxX,strokeMaxY;
  private float dirtyMinX,dirtyMinY,dirtyMaxX,dirtyMaxY;
  private boolean inputEnabled=false,drawing=false;
  private StrokeListener listener;

  public FrontBufferInkView(Context context){
    super(context);
    setBackgroundColor(Color.TRANSPARENT);
    setWillNotDraw(false);
    setClickable(false);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeCap(Paint.Cap.ROUND);
    paint.setStrokeJoin(Paint.Join.ROUND);
  }

  public void setStrokeListener(StrokeListener value){listener=value;}
  public void setInkColor(int value){inkColor=value;}
  public void setInkWidth(float value){inkWidth=Math.max(1f,value);}
  public void setInputEnabled(boolean value){
    if(!value)cancelActive();
    inputEnabled=value;
    setClickable(value);
    setEnabled(value);
  }
  public void clearInk(){cancelActive();}
  public boolean isFastRenderer(){return true;}

  private void ensurePointCapacity(){
    if(pointCount+2<=points.length)return;
    float[] grown=new float[points.length*2];
    System.arraycopy(points,0,grown,0,pointCount);
    points=grown;
  }
  private void storePoint(float x,float y){
    ensurePointCapacity();
    points[pointCount++]=x;
    points[pointCount++]=y;
  }
  private void beginDirty(float x,float y){
    dirtyMinX=dirtyMaxX=x;
    dirtyMinY=dirtyMaxY=y;
  }
  private void expandBounds(float x,float y){
    if(x<dirtyMinX)dirtyMinX=x;if(x>dirtyMaxX)dirtyMaxX=x;
    if(y<dirtyMinY)dirtyMinY=y;if(y>dirtyMaxY)dirtyMaxY=y;
    if(x<strokeMinX)strokeMinX=x;if(x>strokeMaxX)strokeMaxX=x;
    if(y<strokeMinY)strokeMinY=y;if(y>strokeMaxY)strokeMaxY=y;
  }
  private void appendPoint(float x,float y){
    storePoint(x,y);
    livePath.lineTo(x,y);
    expandBounds(x,y);
    lastX=x;lastY=y;
  }
  private void invalidateDirty(){
    int margin=(int)Math.ceil(strokeWidth*.5f)+4;
    invalidate((int)Math.floor(dirtyMinX)-margin,(int)Math.floor(dirtyMinY)-margin,
      (int)Math.ceil(dirtyMaxX)+margin,(int)Math.ceil(dirtyMaxY)+margin);
  }
  private void invalidateWholeStroke(){
    int margin=(int)Math.ceil(strokeWidth*.5f)+4;
    invalidate((int)Math.floor(strokeMinX)-margin,(int)Math.floor(strokeMinY)-margin,
      (int)Math.ceil(strokeMaxX)+margin,(int)Math.ceil(strokeMaxY)+margin);
  }
  private float[] copyPoints(){
    float[] out=new float[pointCount];
    System.arraycopy(points,0,out,0,pointCount);
    return out;
  }
  private void cancelActive(){
    if(drawing)invalidateWholeStroke();
    drawing=false;pointCount=0;livePath.reset();
  }
  private void finishStroke(){
    if(!drawing)return;
    float[] completed=pointCount>=4?copyPoints():null;
    int completedColor=strokeColor;float completedWidth=strokeWidth;
    drawing=false;pointCount=0;livePath.reset();
    if(completed!=null&&listener!=null)listener.onStrokeFinished(completed,completedColor,completedWidth);
    invalidateWholeStroke();
  }

  @Override protected void onDraw(Canvas canvas){
    super.onDraw(canvas);
    if(!drawing)return;
    paint.setColor(strokeColor);
    paint.setStrokeWidth(strokeWidth);
    canvas.drawPath(livePath,paint);
  }

  @Override public boolean onTouchEvent(MotionEvent event){
    if(!inputEnabled)return false;
    switch(event.getActionMasked()){
      case MotionEvent.ACTION_DOWN:
        requestUnbufferedDispatch(event);
        strokeColor=inkColor;strokeWidth=inkWidth;pointCount=0;livePath.reset();
        lastX=event.getX();lastY=event.getY();
        strokeMinX=strokeMaxX=lastX;strokeMinY=strokeMaxY=lastY;
        beginDirty(lastX,lastY);storePoint(lastX,lastY);livePath.moveTo(lastX,lastY);drawing=true;
        appendPoint(lastX+.01f,lastY+.01f);invalidateDirty();return true;
      case MotionEvent.ACTION_MOVE:
        if(!drawing)return false;
        beginDirty(lastX,lastY);
        for(int i=0;i<event.getHistorySize();i++)appendPoint(event.getHistoricalX(i),event.getHistoricalY(i));
        appendPoint(event.getX(),event.getY());invalidateDirty();return true;
      case MotionEvent.ACTION_UP:
        if(!drawing)return false;
        beginDirty(lastX,lastY);appendPoint(event.getX(),event.getY());invalidateDirty();finishStroke();return true;
      case MotionEvent.ACTION_CANCEL:
        cancelActive();return true;
      default:return true;
    }
  }
}
