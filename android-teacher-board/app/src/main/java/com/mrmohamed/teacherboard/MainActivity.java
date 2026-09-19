package com.mrmohamed.teacherboard;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int OPEN_PDF_REQUEST = 4201;

    private ContinuousPdfView pdfView;
    private TextView pageStatus;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(46, 70, 67));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(10), dp(6), dp(10), dp(6));
        toolbar.setBackgroundColor(Color.rgb(13, 59, 46));

        Button open = toolbarButton("Open PDF");
        Button fit = toolbarButton("Fit");
        Button zoomOut = toolbarButton("−");
        Button zoomIn = toolbarButton("+");
        Button fullscreen = toolbarButton("Fullscreen");
        pageStatus = new TextView(this);
        pageStatus.setText("Native Preview");
        pageStatus.setTextColor(Color.WHITE);
        pageStatus.setTextSize(17f);
        pageStatus.setGravity(Gravity.CENTER);

        toolbar.addView(open);
        toolbar.addView(fit);
        toolbar.addView(zoomOut);
        toolbar.addView(zoomIn);
        toolbar.addView(pageStatus, new LinearLayout.LayoutParams(0, dp(44), 1f));
        toolbar.addView(fullscreen);

        pdfView = new ContinuousPdfView(this);
        pdfView.setPageListener((page, count) ->
            pageStatus.setText("Page " + page + " of " + count)
        );

        root.addView(toolbar, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));
        root.addView(pdfView, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            0,
            1f
        ));
        setContentView(root);

        open.setOnClickListener(view -> openPdfPicker());
        fit.setOnClickListener(view -> pdfView.fitWidth());
        zoomOut.setOnClickListener(view -> pdfView.zoomBy(0.84f));
        zoomIn.setOnClickListener(view -> pdfView.zoomBy(1.18f));
        fullscreen.setOnClickListener(view -> hideSystemBars());
    }

    private Button toolbarButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(15f);
        button.setAllCaps(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(14), 0, dp(14), 0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            dp(44)
        );
        params.setMargins(dp(4), 0, dp(4), 0);
        button.setLayoutParams(params);
        return button;
    }

    private void openPdfPicker() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(intent, OPEN_PDF_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != OPEN_PDF_REQUEST || resultCode != RESULT_OK || data == null) {
            return;
        }
        Uri uri = data.getData();
        if (uri == null) return;
        try {
            getContentResolver().takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );
        } catch (SecurityException ignored) {
            // Some file providers grant access for this run only.
        }
        pageStatus.setText("Opening PDF…");
        pdfView.open(uri, error -> {
            if (error != null) {
                Toast.makeText(this, "Unable to open this PDF", Toast.LENGTH_LONG).show();
                pageStatus.setText("Open PDF");
            }
        });
    }

    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        pdfView.release();
        super.onDestroy();
    }
}
