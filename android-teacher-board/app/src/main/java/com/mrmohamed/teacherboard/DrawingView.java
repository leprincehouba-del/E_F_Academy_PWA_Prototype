package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.*;
import android.view.MotionEvent;
import android.view.View;
import java.util.*;

public final class DrawingView extends View {
  public enum Tool { PEN, ERASER }
  private static final class Stroke { Path path; Paint paint; Stroke(Path p,Paint q){path=p;paint=q;} }
  private final Map<Integer,ArrayList<Stroke>> pages=new HashMap<>();
  private final Map<Integer,ArrayDeque<Stroke>> redo=new HashMap<>();
  private int page=0, penColor=Color.RED; private Tool tool=Tool.PEN;
  private float penWidth=5f,eraserWidth=32f,lastX,lastY,viewZoom=1f,viewOffsetX=0f,viewOffsetY=0f;
  private boolean inputEnabled=true; private Bitmap cache; private Canvas cacheCanvas; private Path active; private Paint activePaint;
  public DrawingView(Context c){super(c);setBackgroundColor(Color.TRANSPARENT);setLayerType(View.LAYER_TYPE_HARDWARE,null);setWillNotDraw(false);}
  public float getPenWidth(){return penWidth;} public float getEraserWidth(){return eraserWidth;}
  public void setPage(int p){page=p;rebuildCache();invalidate();} public void setTool(Tool t){tool=t;}
  public void setPenColor(int c){penColor=c;} public void setPenWidth(float w){penWidth=Math.max(1f,w);} public void setEraserWidth(float w){eraserWidth=Math.max(4f,w);}
  public void setRealtimeInk(boolean ignored){} public void setInputEnabled(boolean e){inputEnabled=e;setClickable(e);}
  public void setPdfTransform(float zoom,float x,float y){viewZoom=Math.max(.01f,zoom);viewOffsetX=x;viewOffsetY=y;rebuildCache();invalidate();}
  private float pageX(float x){return(x-viewOffsetX)/viewZoom;} private float pageY(float y){return(y-viewOffsetY)/viewZoom;}
  private Path screenPath(Path src){Matrix m=new Matrix();m.setScale(viewZoom,viewZoom);m.postTranslate(viewOffsetX,viewOffsetY);Path out=new Path();src.transform(m,out);return out;}
  public void commitScreenStroke(float[] points,int color,float width){
    if(points==null||points.length<4)return; Path p=new Path();p.moveTo(pageX(points[0]),pageY(points[1]));
    for(int i=2;i+1<points.length;i+=2)p.lineTo(pageX(points[i]),pageY(points[i+1]));
    Paint q=basePaint();q.setColor(color);q.setStrokeWidth(Math.max(1f,width)/viewZoom);q.setXfermode(null);
    pages.computeIfAbsent(page,k->new ArrayList<>()).add(new Stroke(p,q));redo.remove(page);rebuildCache();invalidate();
  }
  public void clearPage(){pages.remove(page);redo.remove(page);rebuildCache();invalidate();}
  public void undo(){ArrayList<Stroke>s=pages.get(page);if(s!=null&&!s.isEmpty()){Stroke x=s.remove(s.size()-1);redo.computeIfAbsent(page,k->new ArrayDeque<>()).push(x);rebuildCache();invalidate();}}
  public void redo(){ArrayDeque<Stroke>r=redo.get(page);if(r!=null&&!r.isEmpty()){pages.computeIfAbsent(page,k->new ArrayList<>()).add(r.pop());rebuildCache();invalidate();}}
  private Paint basePaint(){Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setStyle(Paint.Style.STROKE);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);return p;}
  private Paint makePaint(){Paint p=basePaint();if(tool==Tool.ERASER){p.setColor(Color.TRANSPARENT);p.setStrokeWidth(eraserWidth/viewZoom);p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));}else{p.setColor(penColor);p.setStrokeWidth(penWidth/viewZoom);}return p;}
  @Override protected void onSizeChanged(int w,int h,int ow,int oh){super.onSizeChanged(w,h,ow,oh);if(w>0&&h>0){cache=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);cacheCanvas=new Canvas(cache);rebuildCache();}}
  private void rebuildCache(){if(cache==null||cacheCanvas==null)return;cache.eraseColor(Color.TRANSPARENT);ArrayList<Stroke>s=pages.get(page);if(s!=null)for(Stroke x:s){Paint p=new Paint(x.paint);p.setStrokeWidth(x.paint.getStrokeWidth()*viewZoom);cacheCanvas.drawPath(screenPath(x.path),p);}}
  @Override protected void onDraw(Canvas c){super.onDraw(c);if(cache!=null)c.drawBitmap(cache,0,0,null);}
  private void append(float x,float y){if(active==null)return;active.lineTo(pageX(x),pageY(y));float pad=(tool==Tool.PEN?penWidth:eraserWidth)+6f;if(cacheCanvas!=null){Paint live=new Paint(activePaint);live.setStrokeWidth(activePaint.getStrokeWidth()*viewZoom);cacheCanvas.drawLine(lastX,lastY,x,y,live);}invalidate((int)(Math.min(lastX,x)-pad),(int)(Math.min(lastY,y)-pad),(int)(Math.max(lastX,x)+pad),(int)(Math.max(lastY,y)+pad));lastX=x;lastY=y;}
  @Override public boolean onTouchEvent(MotionEvent e){if(!inputEnabled)return false;float x=e.getX(),y=e.getY();switch(e.getActionMasked()){
    case MotionEvent.ACTION_DOWN:requestUnbufferedDispatch(e);active=new Path();active.moveTo(pageX(x),pageY(y));lastX=x;lastY=y;activePaint=makePaint();redo.remove(page);return true;
    case MotionEvent.ACTION_MOVE:for(int i=0;i<e.getHistorySize();i++)append(e.getHistoricalX(i),e.getHistoricalY(i));append(x,y);return true;
    case MotionEvent.ACTION_UP:append(x,y);if(active!=null){pages.computeIfAbsent(page,k->new ArrayList<>()).add(new Stroke(active,activePaint));active=null;activePaint=null;rebuildCache();invalidate();}return true;
    case MotionEvent.ACTION_CANCEL:active=null;activePaint=null;rebuildCache();invalidate();return true;
    default:return true;}}
}
