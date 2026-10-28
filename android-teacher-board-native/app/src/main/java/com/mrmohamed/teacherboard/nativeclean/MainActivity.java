package com.mrmohamed.teacherboard.nativeclean;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ArrayList<JSONObject> groupRows = new ArrayList<>();
    private SupabaseApi api;
    private LinearLayout loginBox, setupBox;
    private EditText email, password;
    private Spinner groups;
    private TextView status;
    private Button start;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        api = new SupabaseApi(this);
        buildUi();
        if (api.isSignedIn()) showSetupAndLoad(); else showLogin();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(36), dp(24), dp(36), dp(24));
        root.setBackgroundColor(Color.rgb(238, 244, 242));
        scroll.addView(root, new ScrollView.LayoutParams(-1, -1));

        TextView title = text("نقاط الطلاب فوق سبورة Hikvision", 28, Color.rgb(15, 78, 62));
        title.setGravity(Gravity.CENTER); root.addView(title, full(dp(64)));
        TextView explanation = text("السبورة الأصلية للـPDF والكتابة السريعة، وأسماء الطلاب تظل على الجانبين.", 17, Color.DKGRAY);
        explanation.setGravity(Gravity.CENTER); root.addView(explanation, full(dp(62)));
        status = text("", 16, Color.rgb(120, 55, 25));
        status.setGravity(Gravity.CENTER); root.addView(status, full(dp(52)));

        loginBox = new LinearLayout(this); loginBox.setOrientation(LinearLayout.VERTICAL);
        email = field("بريد حساب المالك");
        password = field("كلمة المرور"); password.setInputType(0x00000081);
        Button login = button("تسجيل الدخول");
        loginBox.addView(email, full(dp(58))); loginBox.addView(password, full(dp(58))); loginBox.addView(login, full(dp(58)));
        root.addView(loginBox, new LinearLayout.LayoutParams(-1, -2));

        setupBox = new LinearLayout(this); setupBox.setOrientation(LinearLayout.VERTICAL);
        setupBox.addView(text("اختر المجموعة", 18, Color.BLACK), full(dp(44)));
        groups = new Spinner(this); groups.setBackgroundColor(Color.WHITE);
        start = button("ابدأ فوق السبورة الأصلية");
        Button stop = button("إيقاف أسماء الطلاب");
        Button signOut = button("تسجيل خروج الحساب");
        setupBox.addView(groups, full(dp(64))); setupBox.addView(start, full(dp(62)));
        setupBox.addView(stop, full(dp(58))); setupBox.addView(signOut, full(dp(58)));
        root.addView(setupBox, new LinearLayout.LayoutParams(-1, -2));

        login.setOnClickListener(v -> login());
        start.setOnClickListener(v -> prepareOverlay());
        stop.setOnClickListener(v -> stopService(new Intent(this, StudentOverlayService.class)));
        signOut.setOnClickListener(v -> { stopService(new Intent(this, StudentOverlayService.class)); api.signOut(); showLogin(); });
        setContentView(scroll);
    }

    private void showLogin() {
        loginBox.setVisibility(View.VISIBLE); setupBox.setVisibility(View.GONE);
        status.setText("سجّل بحساب المالك مرة واحدة");
    }

    private void showSetupAndLoad() {
        loginBox.setVisibility(View.GONE); setupBox.setVisibility(View.VISIBLE); loadGroups();
    }

    private void login() {
        String e = email.getText().toString().trim(), p = password.getText().toString();
        if (e.isEmpty() || p.isEmpty()) { status.setText("اكتب البريد وكلمة المرور"); return; }
        status.setText("جارٍ تسجيل الدخول…");
        io.execute(() -> {
            try { api.login(e, p); runOnUiThread(this::showSetupAndLoad); }
            catch (Exception error) { showError("تعذر تسجيل الدخول: " + error.getMessage()); }
        });
    }

    private void loadGroups() {
        status.setText("جارٍ تحميل المجموعات…"); start.setEnabled(false);
        io.execute(() -> {
            try {
                JSONArray data = api.groups(); groupRows.clear();
                ArrayList<String> names = new ArrayList<>();
                for (int i = 0; i < data.length(); i++) {
                    JSONObject row = data.getJSONObject(i); groupRows.add(row);
                    names.add(row.optString("name", row.optString("code", "مجموعة")));
                }
                runOnUiThread(() -> {
                    groups.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
                    status.setText(names.isEmpty() ? "لا توجد مجموعات نشطة" : "اختر المجموعة ثم ابدأ");
                    start.setEnabled(!names.isEmpty());
                });
            } catch (Exception error) { showError("تعذر تحميل المجموعات: " + error.getMessage()); }
        });
    }

    private void prepareOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            status.setText("فعّل السماح بالظهور فوق التطبيقات ثم ارجع");
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())));
            return;
        }
        int index = groups.getSelectedItemPosition();
        if (index < 0 || index >= groupRows.size()) return;
        JSONObject group = groupRows.get(index);
        String groupId = group.optString("id"), groupName = group.optString("name", "المجموعة");
        start.setEnabled(false); status.setText("جارٍ تجهيز أسماء الطلاب…");
        io.execute(() -> {
            try {
                JSONArray students = api.students(groupId);
                getSharedPreferences(StudentOverlayService.PREFS, MODE_PRIVATE).edit()
                    .putString(StudentOverlayService.KEY_GROUP_ID, groupId)
                    .putString(StudentOverlayService.KEY_GROUP_NAME, groupName)
                    .putString(StudentOverlayService.KEY_STUDENTS, students.toString()).apply();
                runOnUiThread(() -> {
                    start.setEnabled(true); status.setText("تم تشغيل " + students.length() + " طالبًا");
                    startService(new Intent(this, StudentOverlayService.class)); launchWhiteboard();
                });
            } catch (Exception error) {
                runOnUiThread(() -> start.setEnabled(true)); showError("تعذر تحميل الطلاب: " + error.getMessage());
            }
        });
    }

    private void launchWhiteboard() {
        Intent query = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = getPackageManager().queryIntentActivities(query, 0);
        for (ResolveInfo info : apps) {
            String label = String.valueOf(info.loadLabel(getPackageManager())).toLowerCase(Locale.ROOT);
            if (label.contains("whiteboard") || label.contains("wonderboard") || label.contains("سبورة")) {
                Intent launch = getPackageManager().getLaunchIntentForPackage(info.activityInfo.packageName);
                if (launch != null) { startActivity(launch); return; }
            }
        }
        Toast.makeText(this, "الأسماء تعمل الآن — افتح تطبيق السبورة الأصلي", Toast.LENGTH_LONG).show();
        startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
    }

    private void showError(String message) { runOnUiThread(() -> { status.setText(message); start.setEnabled(api.isSignedIn()); }); }
    private TextView text(String value, float size, int color) { TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color); return v; }
    private EditText field(String hint) { EditText v = new EditText(this); v.setHint(hint); v.setTextSize(17); v.setBackgroundColor(Color.WHITE); v.setPadding(dp(14), 0, dp(14), 0); return v; }
    private Button button(String value) { Button v = new Button(this); v.setText(value); v.setAllCaps(false); v.setTextSize(17); return v; }
    private LinearLayout.LayoutParams full(int height) { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, height); p.setMargins(0, dp(5), 0, dp(5)); return p; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onDestroy() { io.shutdownNow(); super.onDestroy(); }
}
