package com.mrmohamed.teacherboard.nativeclean;

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
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.github.barteksc.pdfviewer.PDFView;
import com.github.barteksc.pdfviewer.util.FitPolicy;

public final class PdfReaderActivity extends Activity {
    private static final int OPEN_PDF = 8104;
    private static final String READER_PREFS = "group_pdf_reader";
    private PDFView pdf;
    private TextView pageText;
    private TextView title;
    private String groupId;
    private int currentPage;
    private int pageCount;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        showSystemBars();
        groupId = getSharedPreferences(StudentOverlayService.PREFS, MODE_PRIVATE)
            .getString(StudentOverlayService.KEY_GROUP_ID, "default");
        String groupName = getSharedPreferences(StudentOverlayService.PREFS, MODE_PRIVATE)
            .getString(StudentOverlayService.KEY_GROUP_NAME, "المجموعة");
        buildUi(groupName);
        String saved = getSharedPreferences(READER_PREFS, MODE_PRIVATE).getString("uri_" + groupId, "");
        if (!saved.isEmpty()) loadPdf(Uri.parse(saved));
    }

    private void buildUi(String groupName) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(0, dp(58), 0, 0);
        root.setBackgroundColor(Color.rgb(37, 57, 54));

        LinearLayout tools = new LinearLayout(this);
        tools.setGravity(Gravity.CENTER_VERTICAL);
        tools.setPadding(dp(5), dp(3), dp(5), dp(3));
        tools.setBackgroundColor(Color.rgb(236, 241, 239));
        Button open = button("إضافة PDF");
        Button previous = button("◀ السابقة");
        pageText = new TextView(this);
        pageText.setText("لا يوجد كتاب"); pageText.setTextSize(15); pageText.setGravity(Gravity.CENTER);
        Button next = button("التالية ▶");
        Button fit = button("ملاءمة");
        Button minus = button("−");
        Button plus = button("+");
        Button screenTools = button("أدوات الشاشة");
        title = new TextView(this);
        title.setText(groupName + " — افتح أداة Note للكتابة والمسح");
        title.setTextSize(14); title.setGravity(Gravity.CENTER); title.setTextColor(Color.rgb(20, 70, 58));
        tools.addView(open); tools.addView(previous); tools.addView(pageText, new LinearLayout.LayoutParams(dp(130), dp(48)));
        tools.addView(next); tools.addView(fit); tools.addView(minus); tools.addView(plus); tools.addView(screenTools);
        tools.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1f));
        LinearLayout.LayoutParams toolParams = new LinearLayout.LayoutParams(-1, dp(54));
        toolParams.setMargins(dp(220), 0, dp(220), 0);
        root.addView(tools, toolParams);

        FrameLayout stage = new FrameLayout(this);
        stage.setBackgroundColor(Color.rgb(49, 72, 68));
        pdf = new PDFView(this, null);
        pdf.setBackgroundColor(Color.rgb(49, 72, 68));
        pdf.setMinZoom(.65f); pdf.setMidZoom(2f); pdf.setMaxZoom(6f);
        pdf.enableRenderDuringScale(true);
        stage.addView(pdf, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout.LayoutParams stageParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        stageParams.setMargins(dp(220), 0, dp(220), 0);
        root.addView(stage, stageParams);
        setContentView(root);

        open.setOnClickListener(v -> pickPdf());
        previous.setOnClickListener(v -> { if (pageCount > 0) pdf.jumpTo(Math.max(0, currentPage - 1), true); });
        next.setOnClickListener(v -> { if (pageCount > 0) pdf.jumpTo(Math.min(pageCount - 1, currentPage + 1), true); });
        fit.setOnClickListener(v -> fitPage());
        minus.setOnClickListener(v -> setZoom(pdf.getZoom() * .8f));
        plus.setOnClickListener(v -> setZoom(pdf.getZoom() * 1.25f));
        screenTools.setOnClickListener(v -> {
            showSystemBars();
            Toast.makeText(this, "من شريط Hikvision السفلي افتح قائمة التحكم ثم اختر Note", Toast.LENGTH_LONG).show();
        });
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
        Uri uri = data.getData();
        try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
        catch (SecurityException ignored) {}
        getSharedPreferences(READER_PREFS, MODE_PRIVATE).edit().putString("uri_" + groupId, uri.toString()).apply();
        loadPdf(uri);
    }

    private void loadPdf(Uri uri) {
        title.setText("جارٍ فتح كتاب المجموعة…");
        currentPage = getSharedPreferences(READER_PREFS, MODE_PRIVATE).getInt("page_" + groupId, 0);
        pdf.fromUri(uri)
            .enableSwipe(true).swipeHorizontal(false).enableDoubletap(true)
            .defaultPage(currentPage)
            .onLoad(pages -> {
                pageCount = pages;
                currentPage = Math.min(currentPage, Math.max(0, pages - 1));
                updatePageText();
                title.setText("استخدم أداة Note الأصلية للكتابة والمسح");
                pdf.post(this::fitPage);
            })
            .onPageChange((page, count) -> {
                currentPage = page; pageCount = count; updatePageText();
                getSharedPreferences(READER_PREFS, MODE_PRIVATE).edit().putInt("page_" + groupId, page).apply();
            })
            .onError(error -> {
                title.setText("تعذر فتح ملف PDF");
                Toast.makeText(this, "اختر ملف PDF مرة أخرى", Toast.LENGTH_LONG).show();
            })
            .enableAnnotationRendering(true).enableAntialiasing(true)
            .spacing(dp(8)).autoSpacing(true).pageFitPolicy(FitPolicy.WIDTH)
            .fitEachPage(true).pageSnap(false).pageFling(false).nightMode(false).load();
    }

    private void updatePageText() { pageText.setText(pageCount <= 0 ? "لا يوجد كتاب" : (currentPage + 1) + " / " + pageCount); }
    private void fitPage() { if (pageCount > 0 && !pdf.isRecycled()) pdf.fitToWidth(currentPage); }
    private void setZoom(float value) {
        if (pdf.isRecycled() || pdf.getWidth() <= 0) return;
        float zoom = Math.max(pdf.getMinZoom(), Math.min(pdf.getMaxZoom(), value));
        pdf.zoomCenteredTo(zoom, new PointF(pdf.getWidth() / 2f, pdf.getHeight() / 2f));
        pdf.loadPages();
    }
    private Button button(String text) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setTextSize(13);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(8), 0, dp(8), 0);
        b.setLayoutParams(new LinearLayout.LayoutParams(-2, dp(48))); return b;
    }
    private void showSystemBars() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onDestroy() { if (pdf != null && !pdf.isRecycled()) pdf.recycle(); super.onDestroy(); }
}
