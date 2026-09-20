package com.mrmohamed.teacherboard;

import android.content.Context;
import android.graphics.Color;
import android.opengl.GLES20;
import android.opengl.Matrix;
import android.os.Build;
import android.view.MotionEvent;
import android.view.SurfaceView;
import androidx.annotation.RequiresApi;
import androidx.graphics.lowlatency.BufferInfo;
import androidx.graphics.lowlatency.GLFrontBufferedRenderer;
import androidx.graphics.opengl.egl.EGLManager;
import java.util.Collection;

@RequiresApi(Build.VERSION_CODES.Q)
public final class FrontBufferInkView extends SurfaceView {
  private GLFrontBufferedRenderer<float[]> renderer; private GLLineRenderer lines;
  private float lastX,lastY; private int inkColor=Color.RED; private float inkWidth=5f; private boolean enabled=true;
  public FrontBufferInkView(Context c){super(c);setZOrderOnTop(true);getHolder().setFormat(android.graphics.PixelFormat.TRANSLUCENT);}
  public void setInkColor(int c){inkColor=c;} public void setInkWidth(float w){inkWidth=w;} public void setInputEnabled(boolean e){enabled=e;setClickable(e);}
  private GLLineRenderer lr(){if(lines==null)lines=new GLLineRenderer();return lines;}
  private final GLFrontBufferedRenderer.Callback<float[]> cb=new GLFrontBufferedRenderer.Callback<float[]>(){
    final float[] ortho=new float[16],proj=new float[16];
    private void prep(BufferInfo b,float[] t){GLES20.glViewport(0,0,b.getWidth(),b.getHeight());Matrix.orthoM(ortho,0,0,b.getWidth(),0,b.getHeight(),-1,1);Matrix.multiplyMM(proj,0,ortho,0,t,0);}
    @Override public void onDrawFrontBufferedLayer(EGLManager e,int w,int h,BufferInfo b,float[] t,float[] p){prep(b,t);lr().draw(proj,p,inkColor,inkWidth);}
    @Override public void onDrawMultiBufferedLayer(EGLManager e,int w,int h,BufferInfo b,float[] t,Collection<? extends float[]> ps){GLES20.glClearColor(0,0,0,0);GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);prep(b,t);for(float[] p:ps)lr().draw(proj,p,inkColor,inkWidth);}
  };
  @Override protected void onAttachedToWindow(){super.onAttachedToWindow();renderer=new GLFrontBufferedRenderer<>(this,cb);}
  @Override protected void onDetachedFromWindow(){if(renderer!=null)renderer.release(true,null);renderer=null;super.onDetachedFromWindow();}
  @Override public boolean onTouchEvent(MotionEvent e){if(!enabled)return false;float x=e.getX(),y=e.getY();switch(e.getActionMasked()){case MotionEvent.ACTION_DOWN:requestUnbufferedDispatch(e);lastX=x;lastY=y;return true;case MotionEvent.ACTION_MOVE:if(renderer!=null)renderer.renderFrontBufferedLayer(new float[]{lastX,lastY,x,y});lastX=x;lastY=y;return true;case MotionEvent.ACTION_UP:case MotionEvent.ACTION_CANCEL:if(renderer!=null)renderer.commit();return true;}return true;}
}