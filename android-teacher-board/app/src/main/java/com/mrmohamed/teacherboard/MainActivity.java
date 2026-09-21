package com.mrmohamed.teacherboard;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PointF;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.MotionEvent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.FrameLayout;
import android.widget.SeekBar;
import com.github.barteksc.pdfviewer.PDFView;
import com.github.barteksc.pdfviewer.util.FitPolicy;

public final class MainActivity extends Activity {
  private static final int OPEN_PDF_REQUEST=4201;
  private PDFView pdfView; private TextView pageStatus; private DrawingView drawingView,miniDraw;
  private FrontBufferInkView frontInk; private FrameLayout stage,miniBoard; private boolean miniMinimized=false;
  private int selectedColor=Color.RED; private float selectedPenWidth=5f;

  @Override protected void onCreate(Bundle state){
    super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);hideSystemBars();
    LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.rgb(46,70,67));
    LinearLayout toolbar=new LinearLayout(this);toolbar.setOrientation(LinearLayout.HORIZONTAL);toolbar.setGravity(Gravity.CENTER_VERTICAL);toolbar.setPadding(dp(10),dp(6),dp(10),dp(6));toolbar.setBackgroundColor(Color.rgb(13,59,46));
    Button open=toolbarButton("Open"),fit=toolbarButton("Fit"),zoomOut=toolbarButton("−"),zoomIn=toolbarButton("+"),hand=toolbarButton("Hand"),eraser=toolbarButton("Eraser"),pen=toolbarButton("Pen"),undo=toolbarButton("Undo"),redo=toolbarButton("Redo"),clear=toolbarButton("Clear"),board=toolbarButton("Board"),fullscreen=toolbarButton("Full");
    SeekBar eraserSize=compactSeek(90,32),penSize=compactSeek(24,5);
    Button yellow=colorButton(Color.rgb(255,190,70)),green=colorButton(Color.rgb(55,165,110)),black=colorButton(Color.DKGRAY),blue=colorButton(Color.rgb(60,130,205)),red=colorButton(Color.rgb(235,80,85));
    pageStatus=new TextView(this);pageStatus.setText(versionLabel());pageStatus.setTextColor(Color.WHITE);pageStatus.setTextSize(12f);pageStatus.setGravity(Gravity.CENTER);
    toolbar.addView(open);toolbar.addView(fit);toolbar.addView(zoomOut);toolbar.addView(zoomIn);toolbar.addView(hand);toolbar.addView(eraser);toolbar.addView(eraserSize);toolbar.addView(pen);toolbar.addView(penSize);toolbar.addView(yellow);toolbar.addView(green);toolbar.addView(black);toolbar.addView(blue);toolbar.addView(red);toolbar.addView(undo);toolbar.addView(redo);toolbar.addView(clear);toolbar.addView(board);toolbar.addView(fullscreen);toolbar.addView(pageStatus,new LinearLayout.LayoutParams(dp(82),dp(44)));
    pdfView=new PDFView(this,null);pdfView.setBackgroundColor(Color.rgb(51,76,72));pdfView.setMinZoom(.5f);pdfView.setMidZoom(2f);pdfView.setMaxZoom(5f);pdfView.enableRenderDuringScale(true);
    root.addView(toolbar,new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,LinearLayout.LayoutParams.WRAP_CONTENT));
    stage=new FrameLayout(this);stage.addView(pdfView,new FrameLayout.LayoutParams(-1,-1));
    drawingView=new DrawingView(this);drawingView.setInputEnabled(false);drawingView.setVisibility(View.VISIBLE);stage.addView(drawingView,new FrameLayout.LayoutParams(-1,-1));
    if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q){frontInk=new FrontBufferInkView(this);frontInk.setInputEnabled(false);frontInk.setInkColor(selectedColor);frontInk.setInkWidth(selectedPenWidth);frontInk.setStrokeListener((points,color,width)->drawingView.commitScreenStroke(points,color,width));stage.addView(frontInk,new FrameLayout.LayoutParams(-1,-1));}
    createMiniBoard();root.addView(stage,new LinearLayout.LayoutParams(-1,0,1f));setContentView(root);pageStatus.setText(versionLabel());

    open.setOnClickListener(v->openPdfPicker());fit.setOnClickListener(v->setZoomImmediately(pdfView.getMinZoom()));zoomOut.setOnClickListener(v->changeZoom(.75f));zoomIn.setOnClickListener(v->changeZoom(1.35f));
    hand.setOnClickListener(v->activateHand());pen.setOnClickListener(v->activatePen());eraser.setOnClickListener(v->activateEraser());
    penSize.setOnSeekBarChangeListener(sizeListener(true));eraserSize.setOnSeekBarChangeListener(sizeListener(false));
    yellow.setOnClickListener(v->selectPenColor(Color.rgb(255,190,70)));green.setOnClickListener(v->selectPenColor(Color.rgb(55,165,110)));black.setOnClickListener(v->selectPenColor(Color.DKGRAY));blue.setOnClickListener(v->selectPenColor(Color.rgb(60,130,205)));red.setOnClickListener(v->selectPenColor(Color.rgb(235,80,85)));
    undo.setOnClickListener(v->{clearFastOverlay();drawingView.undo();});redo.setOnClickListener(v->{clearFastOverlay();drawingView.redo();});clear.setOnClickListener(v->{clearFastOverlay();drawingView.clearPage();});
    board.setOnClickListener(v->toggleMiniBoard());fullscreen.setOnClickListener(v->hideSystemBars());activateHand();
  }

  private String versionLabel(){return Build.VERSION.SDK_INT>=Build.VERSION_CODES.Q?"v27 FAST":"v27 COMPAT";}
  private void activateHand(){clearFastOverlay();drawingView.setInputEnabled(false);syncInkTransform();pdfView.bringToFront();drawingView.bringToFront();drawingView.setClickable(false);if(miniBoard.getVisibility()==View.VISIBLE)miniBoard.bringToFront();}
  private void activatePen(){syncInkTransform();drawingView.setTool(DrawingView.Tool.PEN);drawingView.setInputEnabled(frontInk==null);miniDraw.setTool(DrawingView.Tool.PEN);drawingView.bringToFront();if(frontInk!=null){frontInk.setInkColor(selectedColor);frontInk.setInkWidth(selectedPenWidth);frontInk.setInputEnabled(true);frontInk.bringToFront();}if(miniBoard.getVisibility()==View.VISIBLE)miniBoard.bringToFront();}
  private void activateEraser(){clearFastOverlay();syncInkTransform();if(frontInk!=null)frontInk.setInputEnabled(false);drawingView.setTool(DrawingView.Tool.ERASER);drawingView.setInputEnabled(true);miniDraw.setTool(DrawingView.Tool.ERASER);drawingView.bringToFront();if(miniBoard.getVisibility()==View.VISIBLE)miniBoard.bringToFront();}
  private void clearFastOverlay(){if(frontInk!=null){frontInk.setInputEnabled(false);frontInk.clearInk();}}
  private void selectPenColor(int color){selectedColor=color;drawingView.setPenColor(color);miniDraw.setPenColor(color);if(frontInk!=null)frontInk.setInkColor(color);activatePen();}

  private Button toolbarButton(String label){Button b=new Button(this);b.setText(label);b.setTextSize(12f);b.setAllCaps(false);b.setMinHeight(0);b.setMinimumHeight(0);b.setPadding(dp(8),0,dp(8),0);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(44));p.setMargins(dp(2),0,dp(2),0);b.setLayoutParams(p);return b;}
  private void openPdfPicker(){Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/pdf");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);startActivityForResult(i,OPEN_PDF_REQUEST);}
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){super.onActivityResult(requestCode,resultCode,data);if(requestCode!=OPEN_PDF_REQUEST||resultCode!=RESULT_OK||data==null)return;Uri uri=data.getData();if(uri==null)return;try{getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(SecurityException ignored){}
    pageStatus.setText(versionLabel());clearFastOverlay();drawingView.clearDocument();pdfView.fromUri(uri).enableSwipe(true).swipeHorizontal(false).enableDoubletap(true).defaultPage(0)
      .onLoad(n->{pageStatus.setText(versionLabel());drawingView.setPage(0);syncInkTransform();})
      .onPageScroll((p,offset)->syncInkTransform())
      .onPageChange((p,n)->{clearFastOverlay();pageStatus.setText(versionLabel());drawingView.setPage(p);pdfView.post(this::syncInkTransform);})
      .onError(e->{Toast.makeText(this,"Unable to open this PDF",Toast.LENGTH_LONG).show();pageStatus.setText("Open PDF");})
      .onPageError((p,e)->Toast.makeText(this,"Page "+(p+1)+" could not be rendered",Toast.LENGTH_SHORT).show())
      .enableAnnotationRendering(true).enableAntialiasing(true).spacing(dp(10)).autoSpacing(false).pageFitPolicy(FitPolicy.WIDTH).fitEachPage(true).pageSnap(false).pageFling(false).nightMode(false).load();
  }

  private void createMiniBoard(){miniBoard=new FrameLayout(this);miniBoard.setBackgroundColor(Color.WHITE);miniBoard.setVisibility(View.GONE);miniBoard.setElevation(dp(12));miniDraw=new DrawingView(this);miniDraw.setPenColor(Color.BLACK);miniBoard.addView(miniDraw,new FrameLayout.LayoutParams(-1,-1));
    Button close=new Button(this),min=new Button(this),smaller=new Button(this),bigger=new Button(this);close.setText("×");min.setText("—");smaller.setText("−");bigger.setText("+");close.setTextSize(18);close.setPadding(0,0,0,0);min.setPadding(0,0,0,0);smaller.setPadding(0,0,0,0);bigger.setPadding(0,0,0,0);
    FrameLayout.LayoutParams cp=new FrameLayout.LayoutParams(dp(42),dp(42),Gravity.TOP|Gravity.RIGHT);miniBoard.addView(close,cp);FrameLayout.LayoutParams mp=new FrameLayout.LayoutParams(dp(42),dp(42),Gravity.TOP|Gravity.RIGHT);mp.rightMargin=dp(44);miniBoard.addView(min,mp);FrameLayout.LayoutParams sp=new FrameLayout.LayoutParams(dp(42),dp(42),Gravity.TOP|Gravity.RIGHT);sp.rightMargin=dp(88);miniBoard.addView(smaller,sp);FrameLayout.LayoutParams bp=new FrameLayout.LayoutParams(dp(42),dp(42),Gravity.TOP|Gravity.RIGHT);bp.rightMargin=dp(132);miniBoard.addView(bigger,bp);
    close.setOnClickListener(v->miniBoard.setVisibility(View.GONE));min.setOnClickListener(v->toggleMiniMinimize());smaller.setOnClickListener(v->resizeMiniBoard(.85f));bigger.setOnClickListener(v->resizeMiniBoard(1.15f));FrameLayout.LayoutParams p=new FrameLayout.LayoutParams(dp(560),dp(330),Gravity.CENTER);stage.addView(miniBoard,p);
    miniBoard.setOnTouchListener((v,e)->{if(e.getAction()==MotionEvent.ACTION_MOVE&&e.getPointerCount()>1){v.setX(e.getRawX()-v.getWidth()/2f);v.setY(e.getRawY()-v.getHeight()/2f);return true;}return false;});}
  private void toggleMiniBoard(){miniBoard.setVisibility(miniBoard.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE);}
  private void resizeMiniBoard(float f){FrameLayout.LayoutParams p=(FrameLayout.LayoutParams)miniBoard.getLayoutParams();p.width=(int)Math.max(dp(300),Math.min(stage.getWidth()-dp(30),p.width*f));p.height=(int)Math.max(dp(180),Math.min(stage.getHeight()-dp(30),p.height*f));miniBoard.setLayoutParams(p);}
  private void toggleMiniMinimize(){FrameLayout.LayoutParams p=(FrameLayout.LayoutParams)miniBoard.getLayoutParams();if(!miniMinimized){miniBoard.setTag(new int[]{p.width,p.height});p.width=dp(220);p.height=dp(52);miniDraw.setVisibility(View.GONE);miniMinimized=true;}else{int[]old=(int[])miniBoard.getTag();if(old!=null){p.width=old[0];p.height=old[1];}miniDraw.setVisibility(View.VISIBLE);miniMinimized=false;}miniBoard.setLayoutParams(p);}
  private SeekBar compactSeek(int max,int value){SeekBar s=new SeekBar(this);s.setMax(max);s.setProgress(value);s.setPadding(dp(5),0,dp(5),0);s.setLayoutParams(new LinearLayout.LayoutParams(dp(82),dp(44)));return s;}
  private Button colorButton(int color){Button b=new Button(this);b.setText("");b.setBackgroundColor(color);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(dp(18),dp(18));p.setMargins(dp(2),dp(13),dp(2),dp(13));b.setLayoutParams(p);return b;}
  private SeekBar.OnSeekBarChangeListener sizeListener(boolean pen){return new SeekBar.OnSeekBarChangeListener(){public void onProgressChanged(SeekBar s,int v,boolean from){float size=Math.max(pen?2:12,v);if(pen){selectedPenWidth=size;drawingView.setPenWidth(size);miniDraw.setPenWidth(size);if(frontInk!=null)frontInk.setInkWidth(size);}else{drawingView.setEraserWidth(size);miniDraw.setEraserWidth(size);}}public void onStartTrackingTouch(SeekBar s){}public void onStopTrackingTouch(SeekBar s){}};}
  private void syncInkTransform(){if(pdfView!=null&&!pdfView.isRecycled())drawingView.setPdfTransform(pdfView.getZoom(),pdfView.getCurrentXOffset(),pdfView.getCurrentYOffset());}
  private void changeZoom(float f){if(!canZoom())return;setZoomImmediately(Math.max(pdfView.getMinZoom(),Math.min(pdfView.getMaxZoom(),pdfView.getZoom()*f)));}
  private void setZoomImmediately(float z){if(!canZoom())return;clearFastOverlay();pdfView.zoomCenteredTo(z,new PointF(pdfView.getWidth()/2f,pdfView.getHeight()/2f));pdfView.loadPages();pdfView.invalidate();pdfView.post(this::syncInkTransform);}
  private boolean canZoom(){return pdfView!=null&&!pdfView.isRecycled()&&pdfView.getWidth()>0&&pdfView.getHeight()>0;}
  private void hideSystemBars(){getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);}
  private int dp(int v){return Math.round(v*getResources().getDisplayMetrics().density);}
  @Override protected void onDestroy(){if(pdfView!=null&&!pdfView.isRecycled())pdfView.recycle();super.onDestroy();}
}
