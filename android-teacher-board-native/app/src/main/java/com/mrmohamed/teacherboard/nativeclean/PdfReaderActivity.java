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
    private LinearLayout floatingTools;
    private Button toolsTab;
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
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(37, 57, 54));

        FrameLayout stage = new FrameLayout(this);
        stage.setBackgroundColor(Color.rgb(49, 72, 68));
        pdf = new PDFView(this, null);
        pdf.setBackgroundColor(Color.rgb(49, 72, 68));
        pdf.setMinZoom(.65f); pdf.setMidZoom(2f); pdf.setMaxZoom(6f);
        pdf.enableRenderDuringScale(true);
        stage.addView(pdf, new FrameLayout.LayoutParams(-1, -1));
        FrameLayout.LayoutParams stageParams = new FrameLayout.LayoutParams(-1, -1);
        stageParams.setMargins(dp(220), 0, dp(220), 0);
        root.addView(stage, stageParams);

        floatingTools = new LinearLayout(this);
        floatingTools.setGravity(Gravity.CENTER_VERTICAL);
        floatingTools.setPadding(dp(4), dp(2), dp(4), dp(2));
        floatingTools.setBackgroundColor(Color.argb(238, 236, 241, 239));
        Button open = button("إضافة PDF");
        Button previous = button("◀ السابقة");
        pageText = new TextView(this);
        pageText.setText("لا يوجد كتاب"); pageText.setTextSize(14); pageText.setGravity(Gravity.CENTER);
        Button next = button("التالية ▶");
        Button fit = button("ملاءمة");
        Button minus = button("−");
        Button plus = button("+");
        Button collapse = button("إخفاء الشريط");
        floatingTools.addView(open); floatingTools.addView(previous);
        floatingTools.addView(pageText, new LinearLayout.LayoutParams(dp(115), dp(36)));
        floatingTools.addView(next); floatingTools.addView(fit);
        floatingTools.addView(minus); floatingTools.addView(plus); floatingTools.addView(collapse);
        FrameLayout.LayoutParams toolParams = new FrameLayout.LayoutParams(-2, dp(40), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        toolParams.topMargin = dp(60);
        root.addView(floatingTools, toolParams);

        toolsTab = button("PDF");
        toolsTab.setVisibility(View.GONE);
        FrameLayout.LayoutParams tabParams = new FrameLayout.LayoutParams(dp(72), dp(36), Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        tabParams.topMargin = dp(60);
        root.addView(toolsTab, tabParams);
        setContentView(root);

        open.setOnClickListener(v -> pickPdf());
        previous.setOnClickListener(v -> { if (pageCount > 0) pdf.jumpTo(Math.max(0, currentPage - 1), true); });
        next.setOnClickListener(v -> { if (pageCount > 0) pdf.jumpTo(Math.min(pageCount - 1, currentPage + 1), true); });
        fit.setOnClickListener(v -> fitPage());
        minus.setOnClickListener(v -> setZoom(pdf.getZoom() * .8f));
        plus.setOnClickListener(v -> setZoom(pdf.getZoom() * 1.25f));
        collapse.setOnClickListener(v -> setToolsExpanded(false));
        toolsTab.setOnClickListener(v -> setToolsExpanded(true));
    }

    private void setToolsExpanded(boolean expanded) {
        floatingTools.setVisibility(expanded ? View.VISIBLE : View.GONE);
        toolsTab.setVisibility(expanded ? View.GONE : View.VISIBLE);
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
        pageText.setText("جارٍ الفتح…");
        currentPage = getSharedPreferences(READER_PREFS, MODE_PRIVATE).getInt("page_" + groupId, 0);
        pdf.fromUri(uri)
            .enableSwipe(true).swipeHorizontal(false).enableDoubletap(true)
            .defaultPage(currentPage)
            .onLoad(pages -> {
                pageCount = pages;
                currentPage = Math.min(currentPage, Math.max(0, pages - 1));
                updatePageText();
                pdf.post(this::fitPage);
            })
            .onPageChange((page, count) -> {
                currentPage = page; pageCount = count; updatePageText();
                getSharedPreferences(READER_PREFS, MODE_PRIVATE).edit().putInt("page_" + groupId, page).apply();
            })
            .onError(error -> {
                pageText.setText("تعذر الفتح");
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
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setTextSize(12);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setPadding(dp(8), 0, dp(8), 0);
        b.setLayoutParams(new LinearLayout.LayoutParams(-2, dp(36))); return b;
    }
    private void showSystemBars() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onDestroy() { if (pdf != null && !pdf.isRecycled()) pdf.recycle(); super.onDestroy(); }
}
