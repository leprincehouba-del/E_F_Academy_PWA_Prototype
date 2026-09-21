package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Build;
import android.view.MotionEvent;
import android.view.View;
import android.widget.FrameLayout;
import androidx.graphics.lowlatency.LowLatencyCanvasView;
import java.util.ArrayList;
import java.util.concurrent.ConcurrentLinkedQueue;

public final class FrontBufferInkView extends FrameLayout {
  public interface StrokeListener { void onStrokeFinished(float[] points, int color, float width); }
  private static final class Segment {
    final float x1,y1,x2,y2,width; final int color;
    Segment(float a,float b,float c,float d,int e,float f){x1=a;y1=b;x2=c;y2=d;color=e;width=f;}
  }

  private final LowLatencyCanvasView canvasView;
  private final ConcurrentLinkedQueue<Segment> pending=new ConcurrentLinkedQueue<>();
  private final ArrayList<Segment> current=new ArrayList<>();
  private final ArrayList<Float> points=new ArrayList<>();
  private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
  private volatile int inkColor=Color.RED;
  private volatile float inkWidth=5f;
  private boolean inputEnabled=false, drawing=false;
  private long generation=0;
  private float lastX,lastY; private int strokeColor; private float strokeWidth;
  private StrokeListener listener;

  public FrontBufferInkView(Context context){
    super(context);
    setBackgroundColor(Color.TRANSPARENT);
    canvasView=new LowLatencyCanvasView(context);
    canvasView.setBackgroundColor(Color.TRANSPARENT);
    canvasView.setRenderCallback(new LowLatencyCanvasView.Callback(){
      @Override public void onDrawFrontBufferedLayer(Canvas canvas,int width,int height){
        Segment s; while((s=pending.poll())!=null) drawSegment(canvas,s);
      }
      @Override public void onRedrawRequested(Canvas canvas,int width,int height){
        synchronized(current){ for(Segment s:current) drawSegment(canvas,s); }
      }
    });
    canvasView.setOnTouchListener((v,e)->handleTouch(e));
    addView(canvasView,new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT));
    canvasView.post(()->{canvasView.renderFrontBufferedLayer();canvasView.cancel();});
  }

  public void setStrokeListener(StrokeListener value){listener=value;}
  public void setInkColor(int value){inkColor=value;}
  public void setInkWidth(float value){inkWidth=Math.max(1f,value);}
  public void setInputEnabled(boolean value){
    if(!value&&drawing) finishStroke(false);
    inputEnabled=value; canvasView.setClickable(value); canvasView.setEnabled(value);
  }
  public void clearInk(){
    generation++; drawing=false; pending.clear(); synchronized(current){current.clear();} points.clear(); canvasView.clear();
  }
  public boolean isFastRenderer(){return Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q;}

  private void drawSegment(Canvas canvas,Segment s){
    paint.setStyle(Paint.Style.STROKE); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
    paint.setColor(s.color); paint.setStrokeWidth(s.width); canvas.drawLine(s.x1,s.y1,s.x2,s.y2,paint);
  }
  private void addPoint(float x,float y){
    if(!drawing)return;
    if(x==lastX&&y==lastY&&points.size()>2)return;
    Segment s=new Segment(lastX,lastY,x,y,strokeColor,strokeWidth);
    synchronized(current){current.add(s);} pending.add(s); points.add(x); points.add(y); lastX=x; lastY=y;
  }
  private boolean handleTouch(MotionEvent e){
    if(!inputEnabled)return false;
    switch(e.getActionMasked()){
      case MotionEvent.ACTION_DOWN:
        requestUnbufferedDispatch(e); generation++; pending.clear(); synchronized(current){current.clear();} points.clear();
        strokeColor=inkColor; strokeWidth=inkWidth; lastX=e.getX(); lastY=e.getY(); points.add(lastX); points.add(lastY); drawing=true;
        addPoint(lastX+0.01f,lastY+0.01f); canvasView.renderFrontBufferedLayer(); return true;
      case MotionEvent.ACTION_MOVE:
        for(int i=0;i<e.getHistorySize();i++) addPoint(e.getHistoricalX(i),e.getHistoricalY(i));
        addPoint(e.getX(),e.getY()); canvasView.renderFrontBufferedLayer(); return true;
      case MotionEvent.ACTION_UP:
        addPoint(e.getX(),e.getY()); canvasView.renderFrontBufferedLayer(); finishStroke(true); return true;
      case MotionEvent.ACTION_CANCEL:
        canvasView.cancel(); drawing=false; pending.clear(); synchronized(current){current.clear();} points.clear(); return true;
      default:return true;
    }
  }
  private void finishStroke(boolean commit){
    if(!drawing)return; drawing=false;
    if(commit&&listener!=null&&points.size()>=4){
      float[] out=new float[points.size()]; for(int i=0;i<out.length;i++)out[i]=points.get(i);
      listener.onStrokeFinished(out,strokeColor,strokeWidth); canvasView.commit();
      final long completedGeneration=generation;
      postDelayed(()->{if(!drawing&&generation==completedGeneration){pending.clear();synchronized(current){current.clear();}canvasView.clear();}},24L);
    } else canvasView.cancel();
  }
}
