package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.*;
import android.view.MotionEvent;
import android.view.View;
import java.util.*;

public final class DrawingView extends View {
  public enum Tool { PEN, ERASER }
  private static final class Stroke {
    Path path; Paint paint;
    Stroke(Path p, Paint q){ path=p; paint=q; }
  }
  private final Map<Integer, ArrayList<Stroke>> pages=new HashMap<>();
  private final Map<Integer, ArrayDeque<Stroke>> redo=new HashMap<>();
  private int page=0; private Tool tool=Tool.PEN; private int penColor=Color.RED;
  private float penWidth=5f, eraserWidth=32f;
  private float lastX,lastY;
  private boolean realtimeInk=false;
    private Bitmap cache; private Canvas cacheCanvas;
  public float getPenWidth(){return penWidth;} public float getEraserWidth(){return eraserWidth;} private Path active; private Paint activePaint;
  public DrawingView(Context c){ super(c); setBackgroundColor(Color.TRANSPARENT); setLayerType(View.LAYER_TYPE_SOFTWARE,null); setWillNotDraw(false); }
  public void setPage(int p){ page=p; rebuildCache(); invalidate(); }
  public void setTool(Tool t){ tool=t; }
  public void setPenColor(int c){ penColor=c; }
  public void setPenWidth(float w){ penWidth=w; }
  public void setEraserWidth(float w){ eraserWidth=w; }
  public void setRealtimeInk(boolean enabled){ realtimeInk=enabled; setLayerType(View.LAYER_TYPE_SOFTWARE,null); }
  public void clearPage(){ pages.remove(page); redo.remove(page); rebuildCache(); invalidate(); }
  public void undo(){ ArrayList<Stroke> s=pages.get(page); if(s!=null&&!s.isEmpty()){ Stroke x=s.remove(s.size()-1); redo.computeIfAbsent(page,k->new ArrayDeque<>()).push(x); rebuildCache(); invalidate(); } }
  public void redo(){ ArrayDeque<Stroke> r=redo.get(page); if(r!=null&&!r.isEmpty()){ pages.computeIfAbsent(page,k->new ArrayList<>()).add(r.pop()); rebuildCache(); invalidate(); } }
  private Paint makePaint(){
    Paint p=new Paint(Paint.ANTI_ALIAS_FLAG); p.setStyle(Paint.Style.STROKE); p.setStrokeCap(Paint.Cap.ROUND); p.setStrokeJoin(Paint.Join.ROUND);
    if(tool==Tool.ERASER){ p.setColor(Color.TRANSPARENT); p.setStrokeWidth(eraserWidth); p.setBlendMode(BlendMode.CLEAR); }
    else { p.setColor(penColor); p.setStrokeWidth(penWidth); }
    return p;
  }
  @Override protected void onSizeChanged(int w,int h,int oldw,int oldh){ super.onSizeChanged(w,h,oldw,oldh); if(w>0&&h>0){ cache=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888); cacheCanvas=new Canvas(cache); rebuildCache(); } }
  private void rebuildCache(){ if(cacheCanvas==null||cache==null)return; cache.eraseColor(Color.TRANSPARENT); ArrayList<Stroke> s=pages.get(page); if(s!=null)for(Stroke x:s)cacheCanvas.drawPath(x.path,x.paint); }
  @Override protected void onDraw(Canvas c){ super.onDraw(c); if(cache!=null)c.drawBitmap(cache,0,0,null); }
  @Override public boolean onTouchEvent(MotionEvent e){
    float x=e.getX(),y=e.getY();
    switch(e.getActionMasked()){
      case MotionEvent.ACTION_DOWN: active=new Path(); active.moveTo(x,y); lastX=x; lastY=y; activePaint=makePaint(); redo.remove(page); invalidate((int)x-20,(int)y-20,(int)x+20,(int)y+20); return true;
      case MotionEvent.ACTION_MOVE: if(active!=null){ active.lineTo(x,y); float pad=(tool==Tool.PEN?penWidth:eraserWidth)+6f; int l=(int)(Math.min(lastX,x)-pad), t=(int)(Math.min(lastY,y)-pad), r=(int)(Math.max(lastX,x)+pad), b=(int)(Math.max(lastY,y)+pad); if(cacheCanvas!=null) cacheCanvas.drawLine(lastX,lastY,x,y,activePaint); lastX=x; lastY=y; invalidate(l,t,r,b); } return true;
      case MotionEvent.ACTION_UP: case MotionEvent.ACTION_CANCEL:
        if(active!=null){ active.lineTo(x,y); Stroke done=new Stroke(active,activePaint); pages.computeIfAbsent(page,k->new ArrayList<>()).add(done); if(cacheCanvas!=null)cacheCanvas.drawPath(done.path,done.paint); active=null; activePaint=null; invalidate(); } return true;
    } return true;
  }
}