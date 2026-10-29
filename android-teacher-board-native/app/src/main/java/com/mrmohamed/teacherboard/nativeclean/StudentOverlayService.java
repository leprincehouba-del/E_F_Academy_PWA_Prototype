package com.mrmohamed.teacherboard.nativeclean;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.ToneGenerator;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class StudentOverlayService extends Service {
    public static final String PREFS = "student_overlay_state";
    public static final String KEY_GROUP_ID = "group_id";
    public static final String KEY_GROUP_NAME = "group_name";
    public static final String KEY_STUDENTS = "students";
    private static final String KEY_QUEUE = "point_queue";
    private static final String CHANNEL = "student_overlay";
    private static final int NOTIFICATION = 7401;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ArrayList<View> windows = new ArrayList<>();
    private final Map<String, Integer> counts = new HashMap<>();
    private final Map<String, Button> buttons = new HashMap<>();
    private WindowManager manager;
    private SharedPreferences prefs;
    private SupabaseApi api;
    private String groupId, date, lastStudentId;
    private AudioTrack rewardTrack;

    @Override public void onCreate() {
        super.onCreate();
        manager = (WindowManager) getSystemService(WINDOW_SERVICE);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        api = new SupabaseApi(this);
        date = LocalDate.now(ZoneId.of("Africa/Cairo")).toString();
        prepareRewardSound();
        startForegroundNotice();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        showOverlay(); syncQueue(); return START_STICKY;
    }

    private void startForegroundNotice() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "أسماء الطلاب فوق السبورة", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        android.app.Notification n = new android.app.Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_edit).setContentTitle("نقاط الطلاب تعمل فوق السبورة")
            .setContentText("اضغط لاختيار مجموعة أخرى").setContentIntent(open).setOngoing(true).build();
        startForeground(NOTIFICATION, n);
    }

    private void showOverlay() {
        removeWindows();
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return; }
        groupId = prefs.getString(KEY_GROUP_ID, "");
        JSONArray students;
        try { students = new JSONArray(prefs.getString(KEY_STUDENTS, "[]")); }
        catch (Exception error) { students = new JSONArray(); }
        loadCounts();
        LinearLayout left = listPanel(), right = listPanel();
        for (int i = 0; i < students.length(); i++) {
            JSONObject student = students.optJSONObject(i);
            if (student == null) continue;
            Button b = studentButton(student.optString("id"), student.optString("full_name", "طالب"));
            (i % 2 == 0 ? left : right).addView(b);
        }
        addSide(left, Gravity.START | Gravity.CENTER_VERTICAL);
        addSide(right, Gravity.END | Gravity.CENTER_VERTICAL);
        addControls();
    }

    private LinearLayout listPanel() {
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(5), dp(8), dp(5), dp(8));
        list.setBackgroundColor(Color.argb(185, 20, 42, 39));
        return list;
    }

    private Button studentButton(String id, String name) {
        Button b = new Button(this);
        b.setAllCaps(false); b.setTextSize(15); b.setTextColor(Color.rgb(20, 30, 28));
        b.setGravity(Gravity.CENTER); b.setPadding(dp(5), 0, dp(5), 0); b.setTag(name);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.argb(245, 250, 252, 251)); bg.setCornerRadius(dp(13)); b.setBackground(bg);
        refreshButton(b, id);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(53));
        p.setMargins(0, dp(3), 0, dp(3)); b.setLayoutParams(p);
        b.setOnClickListener(v -> addPoint(id, 1)); buttons.put(id, b); return b;
    }

    private void refreshButton(Button b, String id) {
        b.setText(counts.getOrDefault(id, 0) + "   " + String.valueOf(b.getTag()));
    }

    private void addSide(LinearLayout list, int gravity) {
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        scroll.addView(list, new ScrollView.LayoutParams(-1, -2));
        manager.addView(scroll, params(dp(215), -1, gravity)); windows.add(scroll);
    }

    private void addControls() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL); bar.setGravity(Gravity.CENTER);
        bar.setPadding(dp(5), dp(3), dp(5), dp(3)); bar.setBackgroundColor(Color.argb(220, 12, 52, 43));
        Button group = mini("المجموعة"), undo = mini("تراجع"), close = mini("إخفاء");
        bar.addView(group); bar.addView(undo); bar.addView(close);
        group.setOnClickListener(v -> startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)));
        undo.setOnClickListener(v -> { if (lastStudentId != null) addPoint(lastStudentId, -1); });
        close.setOnClickListener(v -> stopSelf());
        WindowManager.LayoutParams p = params(dp(310), dp(52), Gravity.TOP | Gravity.CENTER_HORIZONTAL); p.y = dp(6);
        manager.addView(bar, p); windows.add(bar);
    }

    private Button mini(String text) {
        Button b = new Button(this); b.setText(text); b.setAllCaps(false); b.setTextSize(13);
        b.setMinWidth(0); b.setMinimumWidth(0); b.setLayoutParams(new LinearLayout.LayoutParams(0, -1, 1f)); return b;
    }

    private void addPoint(String studentId, int points) {
        lastStudentId = points > 0 ? studentId : null;
        counts.put(studentId, Math.max(0, counts.getOrDefault(studentId, 0) + points)); saveCounts();
        Button b = buttons.get(studentId); if (b != null) refreshButton(b, studentId);
        if (points > 0) playRewardSound();
        else try { new ToneGenerator(AudioManager.STREAM_MUSIC, 35).startTone(ToneGenerator.TONE_PROP_BEEP, 80); } catch (Exception ignored) {}
        enqueue(studentId, points); syncQueue();
    }

    private synchronized void enqueue(String studentId, int points) {
        try {
            JSONArray queue = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
            queue.put(new JSONObject().put("id", UUID.randomUUID().toString().replace("-", ""))
                .put("studentId", studentId).put("groupId", groupId).put("date", date)
                .put("points", points).put("status", "pending"));
            prefs.edit().putString(KEY_QUEUE, queue.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void syncQueue() {
        io.execute(() -> {
            synchronized (StudentOverlayService.this) {
                try {
                    JSONArray queue = new JSONArray(prefs.getString(KEY_QUEUE, "[]"));
                    boolean changed = false;
                    for (int i = 0; i < queue.length(); i++) {
                        JSONObject e = queue.getJSONObject(i);
                        if (!"pending".equals(e.optString("status"))) continue;
                        try {
                            JSONObject result = api.queuePoint(e.getString("studentId"), e.getInt("points"),
                                "teacher_board_" + e.getString("id"), e.getString("date"));
                            if (result.optBoolean("success", true) && !result.optBoolean("blocked") && !result.optBoolean("closed")) e.put("status", "synced");
                            else {
                                e.put("status", "failed").put("error", result.optString("message", "تعذر تسجيل النقطة"));
                                showToast(result.optString("message", "تعذر تسجيل النقطة"));
                            }
                            changed = true;
                        } catch (Exception network) { break; }
                    }
                    if (changed) prefs.edit().putString(KEY_QUEUE, queue.toString()).apply();
                } catch (Exception ignored) {}
            }
        });
    }

    private void loadCounts() {
        counts.clear();
        try {
            JSONObject object = new JSONObject(prefs.getString(countKey(), "{}"));
            JSONArray names = object.names();
            if (names != null) for (int i = 0; i < names.length(); i++) {
                String id = names.getString(i); counts.put(id, object.optInt(id));
            }
        } catch (Exception ignored) {}
    }

    private void saveCounts() {
        JSONObject object = new JSONObject();
        try { for (Map.Entry<String, Integer> e : counts.entrySet()) object.put(e.getKey(), e.getValue()); }
        catch (Exception ignored) {}
        prefs.edit().putString(countKey(), object.toString()).apply();
    }

    private String countKey() { return "counts_" + groupId + "_" + date; }

    private void prepareRewardSound() {
        try {
            final int rate = 22050;
            final int noteSamples = rate / 9;
            final double[] frequencies = {523.25, 659.25, 783.99, 1046.50};
            short[] samples = new short[noteSamples * frequencies.length];
            for (int n = 0; n < frequencies.length; n++) {
                for (int i = 0; i < noteSamples; i++) {
                    double phase = 2.0 * Math.PI * frequencies[n] * i / rate;
                    double fadeIn = Math.min(1.0, i / (rate * .012));
                    double fadeOut = Math.min(1.0, (noteSamples - i) / (rate * .035));
                    double envelope = Math.min(fadeIn, fadeOut);
                    double bright = Math.sin(phase) + .28 * Math.sin(phase * 2.0);
                    samples[n * noteSamples + i] = (short) (bright * envelope * 10500);
                }
            }
            rewardTrack = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.length * 2).build();
            rewardTrack.write(samples, 0, samples.length);
        } catch (Exception ignored) { rewardTrack = null; }
    }

    private synchronized void playRewardSound() {
        try {
            if (rewardTrack == null) return;
            if (rewardTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) rewardTrack.stop();
            rewardTrack.setPlaybackHeadPosition(0);
            rewardTrack.play();
        } catch (Exception ignored) {}
    }
    private void showToast(String text) { new android.os.Handler(getMainLooper()).post(() -> Toast.makeText(this, text, Toast.LENGTH_LONG).show()); }
    private WindowManager.LayoutParams params(int width, int height, int gravity) {
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(width, height, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT); p.gravity = gravity; return p;
    }
    private void removeWindows() {
        for (View v : windows) try { manager.removeView(v); } catch (Exception ignored) {}
        windows.clear(); buttons.clear();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override public void onDestroy() {
        removeWindows(); io.shutdownNow(); stopForeground(true);
        try { if (rewardTrack != null) rewardTrack.release(); } catch (Exception ignored) {}
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
