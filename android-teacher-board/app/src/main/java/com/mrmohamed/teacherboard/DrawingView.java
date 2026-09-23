package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.*;
import android.view.MotionEvent;
import android.view.View;
import java.util.*;

public final class DrawingView extends View {
  public enum Tool { PEN, ERASER }
  private static final class Stroke { final Path path; final Paint paint; Stroke(Path p,Paint q){path=p;paint=q;} }
  private final Map<Integer,ArrayList<Stroke>> pages=new HashMap<>();
  private final Map<Integer,ArrayDeque<Stroke>> redo=new HashMap<>();
  private int page=0,penColor=Color.RED; private Tool tool=Tool.PEN;
  private float penWidth=5f,eraserWidth=32f,lastX,lastY;
  private float viewZoom=1f,viewOffsetX=0f,viewOffsetY=0f,cacheZoom=1f,cacheOffsetX=0f,cacheOffsetY=0f;
  private boolean inputEnabled=true; private Bitmap cache; private Canvas cacheCanvas; private Path active; private Paint activePaint;
  private final Runnable settleTransform=this::rebuildCache;
  private final Paint cacheLivePaint=new Paint(Paint.ANTI_ALIAS_FLAG);
  private float dirtyMinX,dirtyMinY,dirtyMaxX,dirtyMaxY;

  public DrawingView(Context c){super(c);setBackgroundColor(Color.TRANSPARENT);setLayerType(View.LAYER_TYPE_HARDWARE,null);setWillNotDraw(false);}
  public float getPenWidth(){return penWidth;} public float getEraserWidth(){return eraserWidth;}
  public void setPage(int p){page=p;invalidate();} public void setTool(Tool t){tool=t;}
  public void setPenColor(int c){penColor=c;} public void setPenWidth(float w){penWidth=Math.max(1f,w);} public void setEraserWidth(float w){eraserWidth=Math.max(4f,w);}
  public void setRealtimeInk(boolean ignored){} public void setInputEnabled(boolean e){inputEnabled=e;setClickable(e);}
  public void setPdfTransform(float zoom,float x,float y){viewZoom=Math.max(.01f,zoom);viewOffsetX=x;viewOffsetY=y;invalidate();removeCallbacks(settleTransform);postDelayed(settleTransform,90L);}
  private float documentX(float x){return(x-viewOffsetX)/viewZoom;} private float documentY(float y){return(y-viewOffsetY)/viewZoom;}
  private float cacheX(float x){return x*cacheZoom+cacheOffsetX;} private float cacheY(float y){return y*cacheZoom+cacheOffsetY;}
  private Path transformed(Path src,float zoom,float ox,float oy){Matrix m=new Matrix();m.setScale(zoom,zoom);m.postTranslate(ox,oy);Path out=new Path();src.transform(m,out);return out;}

  public void commitScreenStroke(float[] points,int color,float width){
    if(points==null||points.length<4)return;Path p=new Path();p.moveTo(documentX(points[0]),documentY(points[1]));
    for(int i=2;i+1<points.length;i+=2)p.lineTo(documentX(points[i]),documentY(points[i+1]));
    Paint q=basePaint();q.setColor(color);q.setStrokeWidth(Math.max(1f,width)/viewZoom);
    pages.computeIfAbsent(page,k->new ArrayList<>()).add(new Stroke(p,q));redo.remove(page);
    if(cacheCanvas!=null){Paint live=new Paint(q);live.setStrokeWidth(q.getStrokeWidth()*cacheZoom);cacheCanvas.drawPath(transformed(p,cacheZoom,cacheOffsetX,cacheOffsetY),live);}invalidate();
  }
  public void clearDocument(){pages.clear();redo.clear();rebuildCache();}
  public void clearPage(){pages.remove(page);redo.remove(page);rebuildCache();}
  public void undo(){ArrayList<Stroke>s=pages.get(page);if(s!=null&&!s.isEmpty()){Stroke x=s.remove(s.size()-1);redo.computeIfAbsent(page,k->new ArrayDeque<>()).push(x);rebuildCache();}}
  public void redo(){ArrayDeque<Stroke>r=redo.get(page);if(r!=null&&!r.isEmpty()){pages.computeIfAbsent(page,k->new ArrayList<>()).add(r.pop());rebuildCache();}}
  private Paint basePaint(){Paint p=new Paint(Paint.ANTI_ALIAS_FLAG);p.setStyle(Paint.Style.STROKE);p.setStrokeCap(Paint.Cap.ROUND);p.setStrokeJoin(Paint.Join.ROUND);return p;}
  private Paint makePaint(){Paint p=basePaint();if(tool==Tool.ERASER){p.setColor(Color.TRANSPARENT);p.setStrokeWidth(eraserWidth/viewZoom);p.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.CLEAR));}else{p.setColor(penColor);p.setStrokeWidth(penWidth/viewZoom);}return p;}
  @Override protected void onSizeChanged(int w,int h,int ow,int oh){super.onSizeChanged(w,h,ow,oh);if(w>0&&h>0){cache=Bitmap.createBitmap(w,h,Bitmap.Config.ARGB_8888);cacheCanvas=new Canvas(cache);rebuildCache();}}
  private void rebuildCache(){
    if(cache==null||cacheCanvas==null)return;cache.eraseColor(Color.TRANSPARENT);
    for(ArrayList<Stroke>s:pages.values())for(Stroke x:s){Paint p=new Paint(x.paint);p.setStrokeWidth(x.paint.getStrokeWidth()*viewZoom);cacheCanvas.drawPath(transformed(x.path,viewZoom,viewOffsetX,viewOffsetY),p);}
    cacheZoom=viewZoom;cacheOffsetX=viewOffsetX;cacheOffsetY=viewOffsetY;invalidate();
  }
  @Override protected void onDraw(Canvas c){
    super.onDraw(c);if(cache==null)return;float ratio=viewZoom/Math.max(.01f,cacheZoom);int save=c.save();
    c.translate(viewOffsetX,viewOffsetY);c.scale(ratio,ratio);c.translate(-cacheOffsetX,-cacheOffsetY);c.drawBitmap(cache,0,0,null);c.restoreToCount(save);
  }
  private void beginDirty(){dirtyMinX=dirtyMaxX=lastX;dirtyMinY=dirtyMaxY=lastY;}
  private void expandDirty(float x,float y){if(x<dirtyMinX)dirtyMinX=x;if(x>dirtyMaxX)dirtyMaxX=x;if(y<dirtyMinY)dirtyMinY=y;if(y>dirtyMaxY)dirtyMaxY=y;}
  private void invalidateDirty(){
    float width=tool==Tool.ERASER?eraserWidth:penWidth;int margin=(int)Math.ceil(width*.5f)+4;
    invalidate((int)Math.floor(dirtyMinX)-margin,(int)Math.floor(dirtyMinY)-margin,(int)Math.ceil(dirtyMaxX)+margin,(int)Math.ceil(dirtyMaxY)+margin);
  }
  private void append(float x,float y){
    if(active==null)return;float dx=documentX(x),dy=documentY(y),lastDx=documentX(lastX),lastDy=documentY(lastY);active.lineTo(dx,dy);
    if(cacheCanvas!=null)cacheCanvas.drawLine(cacheX(lastDx),cacheY(lastDy),cacheX(dx),cacheY(dy),cacheLivePaint);
    expandDirty(x,y);lastX=x;lastY=y;
  }
  @Override public boolean onTouchEvent(MotionEvent e){
    if(!inputEnabled)return false;float x=e.getX(),y=e.getY();switch(e.getActionMasked()){
      case MotionEvent.ACTION_DOWN:requestUnbufferedDispatch(e);active=new Path();active.moveTo(documentX(x),documentY(y));lastX=x;lastY=y;activePaint=makePaint();cacheLivePaint.set(activePaint);cacheLivePaint.setStrokeWidth(activePaint.getStrokeWidth()*cacheZoom);redo.remove(page);return true;
      case MotionEvent.ACTION_MOVE:beginDirty();for(int i=0;i<e.getHistorySize();i++)append(e.getHistoricalX(i),e.getHistoricalY(i));append(x,y);invalidateDirty();return true;
      case MotionEvent.ACTION_UP:beginDirty();append(x,y);invalidateDirty();if(active!=null){pages.computeIfAbsent(page,k->new ArrayList<>()).add(new Stroke(active,activePaint));active=null;activePaint=null;}return true;
      case MotionEvent.ACTION_CANCEL:active=null;activePaint=null;rebuildCache();return true;
      default:return true;
    }
  }
}
