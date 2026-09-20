package com.mrmohamed.teacherboard;

import android.graphics.Color;
import android.opengl.GLES20;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

final class GLLineRenderer {
  private static final String VS="uniform mat4 uMVPMatrix; attribute vec4 vPosition; void main(){ gl_Position=uMVPMatrix*vPosition; }";
  private static final String FS="precision highp float; uniform vec4 vColor; void main(){ gl_FragColor=vColor; }";
  private int program=-1,pos=-1,mvp=-1,color=-1; private FloatBuffer buffer;
  void initialize(){ if(program!=-1)return; int vs=shader(GLES20.GL_VERTEX_SHADER,VS),fs=shader(GLES20.GL_FRAGMENT_SHADER,FS); program=GLES20.glCreateProgram(); GLES20.glAttachShader(program,vs);GLES20.glAttachShader(program,fs);GLES20.glLinkProgram(program);pos=GLES20.glGetAttribLocation(program,"vPosition");mvp=GLES20.glGetUniformLocation(program,"uMVPMatrix");color=GLES20.glGetUniformLocation(program,"vColor");buffer=ByteBuffer.allocateDirect(24).order(ByteOrder.nativeOrder()).asFloatBuffer();GLES20.glEnable(GLES20.GL_BLEND);GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA,GLES20.GL_ONE_MINUS_SRC_ALPHA);}
  void draw(float[] matrix,float[] l,int c,float w){initialize();float[] v={l[0],l[1],0,l[2],l[3],0};buffer.position(0);buffer.put(v);buffer.position(0);GLES20.glUseProgram(program);GLES20.glLineWidth(w);GLES20.glEnableVertexAttribArray(pos);GLES20.glVertexAttribPointer(pos,3,GLES20.GL_FLOAT,false,12,buffer);GLES20.glUniformMatrix4fv(mvp,1,false,matrix,0);GLES20.glUniform4f(color,Color.red(c)/255f,Color.green(c)/255f,Color.blue(c)/255f,Color.alpha(c)/255f);GLES20.glDrawArrays(GLES20.GL_LINES,0,2);GLES20.glDisableVertexAttribArray(pos);}
  private int shader(int type,String code){int s=GLES20.glCreateShader(type);GLES20.glShaderSource(s,code);GLES20.glCompileShader(s);return s;}
}