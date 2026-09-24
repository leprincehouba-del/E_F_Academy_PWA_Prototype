package com.mrmohamed.teacherboard;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class WebViewerActivity extends Activity {
  private static final int FILE_REQUEST=4202;
  private static final String OLD_BOARD_URL=
      "https://raw.githack.com/leprincehouba-del/E_F_Academy_PWA_Prototype/80f2247e7c5c548a0bcdeaceee3901d744f48ff7/index.html";
  private WebView webView;
  private ValueCallback<Uri[]> fileCallback;

  @Override protected void onCreate(Bundle state){
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    hideSystemBars();

    LinearLayout root=new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Color.rgb(46,70,67));

    LinearLayout compareBar=new LinearLayout(this);
    compareBar.setOrientation(LinearLayout.HORIZONTAL);
    compareBar.setGravity(Gravity.CENTER_VERTICAL);
    compareBar.setPadding(dp(12),dp(4),dp(8),dp(4));
    compareBar.setBackgroundColor(Color.rgb(13,59,46));

    TextView label=new TextView(this);
    label.setText("v34 COMPARE — WEB VIEWER");
    label.setTextColor(Color.WHITE);
    label.setTextSize(14f);
    compareBar.addView(label,new LinearLayout.LayoutParams(0,dp(44),1f));

    Button nativeButton=new Button(this);
    nativeButton.setText("Native Viewer");
    nativeButton.setAllCaps(false);
    nativeButton.setOnClickListener(v->finish());
    compareBar.addView(nativeButton,new LinearLayout.LayoutParams(dp(150),dp(44)));
    root.addView(compareBar,new LinearLayout.LayoutParams(-1,-2));

    webView=new WebView(this);
    webView.setBackgroundColor(Color.rgb(46,70,67));
    WebSettings settings=webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(true);
    settings.setAllowContentAccess(true);
    settings.setLoadWithOverviewMode(false);
    settings.setUseWideViewPort(true);
    settings.setBuiltInZoomControls(false);
    settings.setMediaPlaybackRequiresUserGesture(false);

    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView,true);

    webView.setWebViewClient(new WebViewClient(){
      @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){
        if(request.isForMainFrame())
          Toast.makeText(WebViewerActivity.this,"تعذر فتح العارض القديم — تحقق من الإنترنت",Toast.LENGTH_LONG).show();
      }
    });
    webView.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        fileCallback=callback;
        try{startActivityForResult(params.createIntent(),FILE_REQUEST);}
        catch(Exception error){fileCallback=null;Toast.makeText(WebViewerActivity.this,"تعذر فتح اختيار الملف",Toast.LENGTH_LONG).show();}
        return true;
      }
    });

    root.addView(webView,new LinearLayout.LayoutParams(-1,0,1f));
    setContentView(root);
    webView.loadUrl(OLD_BOARD_URL);
  }

  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode!=FILE_REQUEST)return;
    ValueCallback<Uri[]> callback=fileCallback;
    fileCallback=null;
    if(callback!=null)callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
  }

  @Override public void onBackPressed(){
    if(webView!=null&&webView.canGoBack())webView.goBack();else super.onBackPressed();
  }

  private void hideSystemBars(){
    getWindow().getDecorView().setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN|
      View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|
      View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
  }
  private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}

  @Override protected void onDestroy(){
    if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}
    if(webView!=null){webView.stopLoading();webView.destroy();webView=null;}
    super.onDestroy();
  }
}
