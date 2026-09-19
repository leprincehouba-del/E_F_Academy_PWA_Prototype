package com.mrmohamed.teacherboard;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PointF;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.FrameLayout;
import android.app.AlertDialog;
import android.widget.SeekBar;
import com.github.barteksc.pdfviewer.PDFView;
import com.github.barteksc.pdfviewer.util.FitPolicy;

public final class MainActivity extends Activity {
    private static final int OPEN_PDF_REQUEST = 4201;
    private PDFView pdfView;
    private TextView pageStatus;
    private DrawingView drawingView;
    private boolean drawMode=false;
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
        LinearLayout root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.rgb(46,70,67));
        LinearLayout toolbar = new LinearLayout(this); toolbar.setOrientation(LinearLayout.HORIZONTAL); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(10),dp(6),dp(10),dp(6)); toolbar.setBackgroundColor(Color.rgb(13,59,46));
        Button open=toolbarButton("Open PDF"), fit=toolbarButton("Fit"), zoomOut=toolbarButton("−"), zoomIn=toolbarButton("+"), pen=toolbarButton("Pen"), penSize=toolbarButton("Pen Size"), color=toolbarButton("Color"), eraser=toolbarButton("Eraser"), eraserSize=toolbarButton("Eraser Size"), undo=toolbarButton("Undo"), redo=toolbarButton("Redo"), clear=toolbarButton("Clear"), fullscreen=toolbarButton("Fullscreen");
        pageStatus=new TextView(this); pageStatus.setText("Native Preview"); pageStatus.setTextColor(Color.WHITE); pageStatus.setTextSize(17f); pageStatus.setGravity(Gravity.CENTER);
        toolbar.addView(open); toolbar.addView(fit); toolbar.addView(zoomOut); toolbar.addView(zoomIn); toolbar.addView(pen); toolbar.addView(penSize); toolbar.addView(color); toolbar.addView(eraser); toolbar.addView(eraserSize); toolbar.addView(undo); toolbar.addView(redo); toolbar.addView(clear); toolbar.addView(pageStatus,new LinearLayout.LayoutParams(0,dp(44),1f)); toolbar.addView(fullscreen);
        pdfView=new PDFView(this,null); pdfView.setBackgroundColor(Color.rgb(51,76,72));
        pdfView.setMinZoom(0.5f); pdfView.setMidZoom(2f); pdfView.setMaxZoom(5f); pdfView.enableRenderDuringScale(true);
        root.addView(toolbar,new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,LinearLayout.LayoutParams.WRAP_CONTENT));
        FrameLayout stage=new FrameLayout(this);
        stage.addView(pdfView,new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.MATCH_PARENT));
        drawingView=new DrawingView(this); drawingView.setVisibility(View.GONE);
        stage.addView(drawingView,new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(stage,new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,0,1f)); setContentView(root);
        open.setOnClickListener(v->openPdfPicker()); fit.setOnClickListener(v->setZoomImmediately(pdfView.getMinZoom()));
        zoomOut.setOnClickListener(v->changeZoom(0.75f)); zoomIn.setOnClickListener(v->changeZoom(1.35f));
        pen.setOnClickListener(v->{drawMode=true;drawingView.setTool(DrawingView.Tool.PEN);drawingView.setVisibility(View.VISIBLE);});
        penSize.setOnClickListener(v->showSizeDialog("Pen Size",true));
        color.setOnClickListener(v->showColorDialog());
        eraser.setOnClickListener(v->{drawMode=true;drawingView.setTool(DrawingView.Tool.ERASER);drawingView.setVisibility(View.VISIBLE);});
        eraserSize.setOnClickListener(v->showSizeDialog("Eraser Size",false));
        undo.setOnClickListener(v->drawingView.undo()); redo.setOnClickListener(v->drawingView.redo());
        clear.setOnClickListener(v->drawingView.clearPage());
        fullscreen.setOnClickListener(v->hideSystemBars());
    }
    private Button toolbarButton(String label){ Button b=new Button(this); b.setText(label); b.setTextSize(15f); b.setAllCaps(false); b.setMinHeight(0); b.setMinimumHeight(0); b.setPadding(dp(14),0,dp(14),0); LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT,dp(44)); p.setMargins(dp(4),0,dp(4),0); b.setLayoutParams(p); return b; }
    private void openPdfPicker(){ Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT); i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("application/pdf"); i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION); startActivityForResult(i,OPEN_PDF_REQUEST); }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){ super.onActivityResult(requestCode,resultCode,data); if(requestCode!=OPEN_PDF_REQUEST||resultCode!=RESULT_OK||data==null)return; Uri uri=data.getData(); if(uri==null)return; try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(SecurityException ignored){}
        pageStatus.setText("Opening PDF…");
        pdfView.fromUri(uri).enableSwipe(true).swipeHorizontal(false).enableDoubletap(true).defaultPage(0)
          .onLoad(n->{pageStatus.setText("Page 1 of "+n);drawingView.setPage(0);}).onPageChange((p,n)->{pageStatus.setText("Page "+(p+1)+" of "+n);drawingView.setPage(p);})
          .onError(e->{Toast.makeText(this,"Unable to open this PDF",Toast.LENGTH_LONG).show();pageStatus.setText("Open PDF");})
          .onPageError((p,e)->Toast.makeText(this,"Page "+(p+1)+" could not be rendered",Toast.LENGTH_SHORT).show())
          .enableAnnotationRendering(true).enableAntialiasing(true).spacing(dp(10)).autoSpacing(false).pageFitPolicy(FitPolicy.WIDTH).fitEachPage(true).pageSnap(false).pageFling(false).nightMode(false).load();
    }
    private void showColorDialog(){
        String[] names={"Red","Black","Blue","Green","Yellow","White"};
        int[] colors={Color.RED,Color.BLACK,Color.BLUE,Color.GREEN,Color.YELLOW,Color.WHITE};
        new AlertDialog.Builder(this).setTitle("Pen Color").setItems(names,(d,w)->drawingView.setPenColor(colors[w])).show();
    }
    private void showSizeDialog(String title,boolean pen){
        LinearLayout box=new LinearLayout(this); box.setPadding(dp(24),dp(12),dp(24),dp(12));
        SeekBar bar=new SeekBar(this); bar.setMax(pen?18:90); bar.setProgress((int)(pen?drawingView.getPenWidth():drawingView.getEraserWidth())); box.addView(bar,new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,dp(60)));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(title).setView(box).setPositiveButton("Done",null).create();
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar s,int v,boolean from){float size=Math.max(pen?2:12,v);if(pen)drawingView.setPenWidth(size);else drawingView.setEraserWidth(size);}public void onStartTrackingTouch(SeekBar s){}public void onStopTrackingTouch(SeekBar s){}});
        dialog.show();
    }
    private void changeZoom(float factor){ if(!canZoom())return; float target=Math.max(pdfView.getMinZoom(),Math.min(pdfView.getMaxZoom(),pdfView.getZoom()*factor)); setZoomImmediately(target); }
    private void setZoomImmediately(float zoom){ if(!canZoom())return; PointF c=new PointF(pdfView.getWidth()/2f,pdfView.getHeight()/2f); pdfView.zoomCenteredTo(zoom,c); pdfView.loadPages(); pdfView.invalidate(); }
    private boolean canZoom(){return pdfView!=null&&!pdfView.isRecycled()&&pdfView.getWidth()>0&&pdfView.getHeight()>0;}
    private void hideSystemBars(){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}
    private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
    @Override protected void onDestroy(){if(pdfView!=null&&!pdfView.isRecycled())pdfView.recycle();super.onDestroy();}
}