package com.mrmohamed.teacherboard.nativeclean;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PointF;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import com.github.barteksc.pdfviewer.PDFView;
import com.github.barteksc.pdfviewer.util.FitPolicy;

/** Isolated native PDF + Ink performance test. No WebView or PDF.js is involved. */
public final class MainActivity extends Activity {
    private static final int OPEN_PDF = 7101;
    private PDFView pdf;
    private NativeInkLayer ink;
    private TextView status;
    private Uri currentDocument;
    private boolean penMode;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(38, 61, 58));

        LinearLayout tools = new LinearLayout(this);
        tools.setGravity(Gravity.CENTER_VERTICAL);
        tools.setPadding(dp(8), dp(4), dp(8), dp(4));
        tools.setBackgroundColor(Color.rgb(15, 66, 52));

        Button open = button("إضافة PDF");
        Button hand = button("تحريك ✋");
        Button pen = button("قلم ✎");
        Button undo = button("تراجع");
        Button clear = button("مسح الكتابة");
        Button fit = button("ملاءمة");
        Button minus = button("−");
        Button plus = button("+");
        SeekBar size = new SeekBar(this);
        size.setMax(28);
        size.setProgress(5);
        size.setLayoutParams(new LinearLayout.LayoutParams(dp(130), dp(44)));
        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(13f);
        status.setGravity(Gravity.CENTER);
        status.setText("Native Clean v1");

        tools.addView(open); tools.addView(hand); tools.addView(pen); tools.addView(size);
        tools.addView(undo); tools.addView(clear); tools.addView(fit); tools.addView(minus); tools.addView(plus);
        tools.addView(status, new LinearLayout.LayoutParams(0, dp(44), 1f));
        root.addView(tools, new LinearLayout.LayoutParams(-1, -2));

        FrameLayout stage = new FrameLayout(this);
        pdf = new PDFView(this, null);
        pdf.setBackgroundColor(Color.rgb(47, 72, 68));
        pdf.setMinZoom(0.55f);
        pdf.setMidZoom(2f);
        pdf.setMaxZoom(6f);
        pdf.enableRenderDuringScale(true);
        stage.addView(pdf, new FrameLayout.LayoutParams(-1, -1));

        ink = new NativeInkLayer(this);
        stage.addView(ink, new FrameLayout.LayoutParams(-1, -1));
        root.addView(stage, new LinearLayout.LayoutParams(-1, 0, 1f));
        setContentView(root);

        open.setOnClickListener(v -> pickPdf());
        hand.setOnClickListener(v -> activateHand());
        pen.setOnClickListener(v -> activatePen());
        undo.setOnClickListener(v -> ink.undo());
        clear.setOnClickListener(v -> ink.clear());
        fit.setOnClickListener(v -> setZoom(pdf.getMinZoom()));
        minus.setOnClickListener(v -> setZoom(pdf.getZoom() * .8f));
        plus.setOnClickListener(v -> setZoom(pdf.getZoom() * 1.25f));
        size.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar bar, int value, boolean fromUser) {
                ink.setPenWidth(Math.max(2, value));
            }
            @Override public void onStartTrackingTouch(SeekBar bar) {}
            @Override public void onStopTrackingTouch(SeekBar bar) {}
        });
        activateHand();
    }

    private void pickPdf() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, OPEN_PDF);
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != OPEN_PDF || resultCode != RESULT_OK || data == null || data.getData() == null) return;
        currentDocument = data.getData();
        try { getContentResolver().takePersistableUriPermission(currentDocument, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
        catch (SecurityException ignored) {}
        loadPdf(currentDocument);
    }

    private void loadPdf(Uri uri) {
        activateHand();
        status.setText("جارٍ فتح الكتاب…");
        pdf.fromUri(uri)
            .enableSwipe(true)
            .swipeHorizontal(false)
            .enableDoubletap(true)
            .defaultPage(0)
            .onLoad(pages -> {
                status.setText("1 / " + pages + "  •  Native Clean v1");
                pdf.post(() -> pdf.fitToWidth(0));
            })
            .onPageChange((page, count) -> status.setText((page + 1) + " / " + count + "  •  Native Clean v1"))
            .onError(error -> {
                status.setText("فشل فتح الكتاب");
                Toast.makeText(this, "تعذر فتح ملف PDF", Toast.LENGTH_LONG).show();
            })
            .onPageError((page, error) -> Toast.makeText(this, "تعذر عرض الصفحة " + (page + 1), Toast.LENGTH_SHORT).show())
            .enableAnnotationRendering(true)
            .enableAntialiasing(true)
            .spacing(dp(8))
            .autoSpacing(false)
            .pageFitPolicy(FitPolicy.WIDTH)
            .fitEachPage(true)
            .pageSnap(false)
            .pageFling(false)
            .nightMode(false)
            .load();
    }

    private void activateHand() {
        penMode = false;
        ink.setDrawingEnabled(false);
        pdf.setSwipeEnabled(true);
        pdf.bringToFront();
    }

    private void activatePen() {
        penMode = true;
        pdf.setSwipeEnabled(false);
        ink.setDrawingEnabled(true);
        ink.bringToFront();
    }

    private void setZoom(float value) {
        if (pdf == null || pdf.isRecycled() || pdf.getWidth() == 0) return;
        float zoom = Math.max(pdf.getMinZoom(), Math.min(pdf.getMaxZoom(), value));
        pdf.zoomCenteredTo(zoom, new PointF(pdf.getWidth() / 2f, pdf.getHeight() / 2f));
        pdf.loadPages();
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(12f);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(8), 0, dp(8), 0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, dp(44));
        params.setMargins(dp(2), 0, dp(2), 0);
        button.setLayoutParams(params);
        return button;
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override protected void onDestroy() {
        if (pdf != null && !pdf.isRecycled()) pdf.recycle();
        super.onDestroy();
    }
}
