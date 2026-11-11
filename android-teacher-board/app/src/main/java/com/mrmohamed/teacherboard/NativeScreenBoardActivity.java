package com.mrmohamed.teacherboard;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PointF;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.github.barteksc.pdfviewer.PDFView;
import com.github.barteksc.pdfviewer.util.FitPolicy;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class NativeScreenBoardActivity extends Activity {
  private static final int OPEN_PDF = 6201;
  private static final String[] REASON_KEYS = {
    "participation", "oral_recitation", "written_recitation", "homework",
    "activity", "quiz", "exam", "behavior"
  };
  private static final String[] REASON_LABELS = {
    "المشاركة", "التسميع الشفوي", "التسميع التحريري", "الواجب",
    "النشاط", "الاختبار", "الامتحان", "السلوك"
  };

  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final List<SupabaseApi.Group> groups = new ArrayList<>();
  private final List<SupabaseApi.Student> students = new ArrayList<>();
  private final Map<String, TextView> countViews = new HashMap<>();
  private final List<PointEvent> pointEvents = new ArrayList<>();

  private SupabaseApi api;
  private SharedPreferences prefs;
  private FrameLayout root;
  private LinearLayout boardLayout;
  private LinearLayout leftStudents;
  private LinearLayout rightStudents;
  private PDFView pdfView;
  private TextView status;
  private TextView groupLabel;
  private Button reasonButton;
  private EditText pageInput;
  private SupabaseApi.Group currentGroup;
  private String selectedReason = "participation";
  private Uri pendingPdfUri;
  private int pageCount;
  private boolean studentsVisible = true;
  private ToneGenerator tone;

  @Override protected void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    hideSystemBars();
    api = new SupabaseApi(this);
    prefs = getSharedPreferences("native_screen_board", MODE_PRIVATE);
    selectedReason = prefs.getString("reason", "participation");
    readEvents();
    showStartingScreen();
    if (api.hasSavedSession()) restoreSession(); else showLogin();
  }

  private void showStartingScreen() {
    root = new FrameLayout(this);
    root.setBackgroundColor(Color.rgb(34, 57, 54));
    TextView loading = new TextView(this);
    loading.setText("جارٍ فتح حساب الشاشة…");
    loading.setTextColor(Color.WHITE);
    loading.setTextSize(24);
    loading.setGravity(Gravity.CENTER);
    root.addView(loading, new FrameLayout.LayoutParams(-1, -1));
    setContentView(root);
  }

  private void showLogin() {
    main.post(() -> {
      LinearLayout panel = new LinearLayout(this);
      panel.setOrientation(LinearLayout.VERTICAL);
      panel.setGravity(Gravity.CENTER);
      panel.setPadding(dp(70), dp(35), dp(70), dp(35));
      panel.setBackgroundColor(Color.WHITE);

      TextView title = text("حساب الشاشة", 30, Color.rgb(20, 69, 57));
      title.setGravity(Gravity.CENTER);
      EditText phone = input("رقم تليفون حساب الشاشة");
      phone.setInputType(android.text.InputType.TYPE_CLASS_PHONE);
      phone.setText("01113565398");
      EditText password = input("كلمة المرور");
      password.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
      Button login = largeButton("تسجيل الدخول");
      TextView message = text("سجّل الدخول مرة واحدة فقط؛ سيحتفظ التطبيق بالجلسة.", 17, Color.DKGRAY);
      message.setGravity(Gravity.CENTER);

      panel.addView(title, matchWrap(0, dp(16)));
      panel.addView(phone, matchHeight(dp(64), dp(8)));
      panel.addView(password, matchHeight(dp(64), dp(8)));
      panel.addView(login, matchHeight(dp(62), dp(10)));
      panel.addView(message, matchWrap(dp(10), 0));

      root.removeAllViews();
      FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(dp(820), -2, Gravity.CENTER);
      root.addView(panel, p);
      login.setOnClickListener(v -> {
        login.setEnabled(false);
        message.setText("جارٍ تسجيل الدخول…");
        io.execute(() -> {
          try {
            api.login(phone.getText().toString(), password.getText().toString());
            main.post(this::loadBoardData);
          } catch (Exception error) {
            main.post(() -> {
              login.setEnabled(true);
              message.setText(error.getMessage() == null ? "تعذر تسجيل الدخول" : error.getMessage());
            });
          }
        });
      });
    });
  }

  private void restoreSession() {
    io.execute(() -> {
      try {
        api.restoreSession();
        main.post(this::loadBoardData);
      } catch (Exception error) {
        api.clearSession();
        main.post(this::showLogin);
      }
    });
  }

  private void loadBoardData() {
    showBoard();
    status.setText("جارٍ تحميل المجموعات…");
    io.execute(() -> {
      try {
        List<SupabaseApi.Group> loaded = api.groups();
        main.post(() -> {
          groups.clear();
          groups.addAll(loaded);
          status.setText(groups.isEmpty() ? "لا توجد مجموعات نشطة" : "اختر المجموعة");
          String saved = prefs.getString("last_group", "");
          SupabaseApi.Group match = null;
          for (SupabaseApi.Group group : groups) if (group.id.equals(saved)) match = group;
          if (match != null) selectGroup(match); else chooseGroup();
        });
      } catch (Exception error) {
        main.post(() -> status.setText("تعذر تحميل المجموعات: " + friendly(error)));
      }
    });
  }

  private void showBoard() {
    root.removeAllViews();
    LinearLayout screen = new LinearLayout(this);
    screen.setOrientation(LinearLayout.VERTICAL);
    screen.setBackgroundColor(Color.rgb(34, 57, 54));
    screen.addView(createToolbar(), new LinearLayout.LayoutParams(-1, dp(56)));

    boardLayout = new LinearLayout(this);
    boardLayout.setOrientation(LinearLayout.HORIZONTAL);
    boardLayout.setLayoutDirection(View.LAYOUT_DIRECTION_LTR);

    leftStudents = new LinearLayout(this);
    leftStudents.setOrientation(LinearLayout.VERTICAL);
    rightStudents = new LinearLayout(this);
    rightStudents.setOrientation(LinearLayout.VERTICAL);
    ScrollView leftScroll = studentScroll(leftStudents);
    ScrollView rightScroll = studentScroll(rightStudents);

    pdfView = new PDFView(this, null);
    pdfView.setBackgroundColor(Color.rgb(44, 70, 66));
    pdfView.setMinZoom(.6f);
    pdfView.setMidZoom(2f);
    pdfView.setMaxZoom(5f);
    pdfView.enableRenderDuringScale(true);

    boardLayout.addView(leftScroll, new LinearLayout.LayoutParams(dp(250), -1));
    boardLayout.addView(pdfView, new LinearLayout.LayoutParams(0, -1, 1f));
    boardLayout.addView(rightScroll, new LinearLayout.LayoutParams(dp(250), -1));
    screen.addView(boardLayout, new LinearLayout.LayoutParams(-1, 0, 1f));
    root.addView(screen, new FrameLayout.LayoutParams(-1, -1));
  }

  private View createToolbar() {
    LinearLayout bar = new LinearLayout(this);
    bar.setOrientation(LinearLayout.HORIZONTAL);
    bar.setGravity(Gravity.CENTER_VERTICAL);
    bar.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
    bar.setPadding(dp(6), dp(4), dp(6), dp(4));
    bar.setBackgroundColor(Color.rgb(13, 59, 46));

    Button group = toolbarButton("المجموعة");
    groupLabel = text("لم تُحدد", 14, Color.WHITE);
    groupLabel.setGravity(Gravity.CENTER);
    reasonButton = toolbarButton("السبب: " + reasonLabel(selectedReason));
    Button undo = toolbarButton("↶ تراجع نقطة");
    Button hide = toolbarButton("إخفاء الأسماء");
    Button addPdf = toolbarButton("إضافة PDF");
    Button fit = toolbarButton("ملاءمة");
    Button minus = toolbarButton("−");
    Button plus = toolbarButton("+");
    pageInput = new EditText(this);
    pageInput.setText("1");
    pageInput.setTextSize(16);
    pageInput.setGravity(Gravity.CENTER);
    pageInput.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
    pageInput.setBackgroundColor(Color.WHITE);
    Button go = toolbarButton("اذهب");
    status = text("Native PDFium", 13, Color.WHITE);
    status.setGravity(Gravity.CENTER);

    bar.addView(group);
    bar.addView(groupLabel, new LinearLayout.LayoutParams(dp(160), dp(46)));
    bar.addView(reasonButton);
    bar.addView(undo);
    bar.addView(hide);
    bar.addView(addPdf);
    bar.addView(fit);
    bar.addView(minus);
    bar.addView(plus);
    bar.addView(pageInput, new LinearLayout.LayoutParams(dp(76), dp(44)));
    bar.addView(go);
    bar.addView(status, new LinearLayout.LayoutParams(0, dp(46), 1f));

    group.setOnClickListener(v -> chooseGroup());
    reasonButton.setOnClickListener(v -> chooseReason());
    undo.setOnClickListener(v -> undoPoint());
    hide.setOnClickListener(v -> {
      studentsVisible = !studentsVisible;
      int visibility = studentsVisible ? View.VISIBLE : View.GONE;
      boardLayout.getChildAt(0).setVisibility(visibility);
      boardLayout.getChildAt(2).setVisibility(visibility);
      hide.setText(studentsVisible ? "إخفاء الأسماء" : "إظهار الأسماء");
    });
    addPdf.setOnClickListener(v -> pickPdf());
    fit.setOnClickListener(v -> fitPdf());
    minus.setOnClickListener(v -> changeZoom(.75f));
    plus.setOnClickListener(v -> changeZoom(1.35f));
    go.setOnClickListener(v -> goToPage());
    return bar;
  }

  private void chooseGroup() {
    if (groups.isEmpty()) return;
    String[] labels = new String[groups.size()];
    for (int i = 0; i < groups.size(); i++) labels[i] = groups.get(i).name;
    new AlertDialog.Builder(this)
      .setTitle("اختر المجموعة")
      .setItems(labels, (dialog, which) -> selectGroup(groups.get(which)))
      .setNegativeButton("إلغاء", null)
      .show();
  }

  private void selectGroup(SupabaseApi.Group group) {
    currentGroup = group;
    prefs.edit().putString("last_group", group.id).apply();
    groupLabel.setText(group.name);
    status.setText("جارٍ تحميل الطلاب…");
    students.clear();
    renderStudents();
    openGroupPdf();
    io.execute(() -> {
      try {
        List<SupabaseApi.Student> loaded = api.students(group.id);
        main.post(() -> {
          if (currentGroup == null || !currentGroup.id.equals(group.id)) return;
          students.clear();
          students.addAll(loaded);
          renderStudents();
          status.setText(loaded.size() + " طالبًا");
          syncPending();
        });
      } catch (Exception error) {
        main.post(() -> status.setText("تعذر تحميل الطلاب: " + friendly(error)));
      }
    });
  }

  private void chooseReason() {
    int selected = 0;
    for (int i = 0; i < REASON_KEYS.length; i++) if (REASON_KEYS[i].equals(selectedReason)) selected = i;
    new AlertDialog.Builder(this)
      .setTitle("سبب النقاط")
      .setSingleChoiceItems(REASON_LABELS, selected, (dialog, which) -> {
        selectedReason = REASON_KEYS[which];
        prefs.edit().putString("reason", selectedReason).apply();
        reasonButton.setText("السبب: " + REASON_LABELS[which]);
        renderStudents();
        dialog.dismiss();
      }).show();
  }

  private void renderStudents() {
    if (leftStudents == null || rightStudents == null) return;
    leftStudents.removeAllViews();
    rightStudents.removeAllViews();
    countViews.clear();
    int split = (students.size() + 1) / 2;
    for (int i = 0; i < students.size(); i++) {
      LinearLayout target = i < split ? leftStudents : rightStudents;
      target.addView(studentButton(students.get(i)), new LinearLayout.LayoutParams(-1, dp(62)));
    }
  }

  private View studentButton(SupabaseApi.Student student) {
    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
    row.setPadding(dp(7), dp(4), dp(7), dp(4));
    row.setBackgroundColor(Color.WHITE);
    LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(-1, dp(60));
    rowParams.setMargins(dp(5), dp(3), dp(5), dp(3));
    row.setLayoutParams(rowParams);

    TextView count = text(String.valueOf(pointCount(student.id)), 17, Color.WHITE);
    count.setGravity(Gravity.CENTER);
    count.setBackgroundColor(Color.rgb(22, 91, 72));
    TextView name = text(student.name, 17, Color.rgb(27, 43, 41));
    name.setGravity(Gravity.CENTER);
    Button add = new Button(this);
    add.setText("＋");
    add.setTextSize(22);
    add.setTextColor(Color.WHITE);
    add.setBackgroundColor(Color.rgb(30, 128, 100));
    add.setPadding(0, 0, 0, 0);

    row.addView(count, new LinearLayout.LayoutParams(dp(42), dp(42)));
    row.addView(name, new LinearLayout.LayoutParams(0, dp(52), 1f));
    row.addView(add, new LinearLayout.LayoutParams(dp(52), dp(52)));
    countViews.put(student.id, count);
    View.OnClickListener listener = v -> addPoint(student);
    add.setOnClickListener(listener);
    name.setOnClickListener(listener);
    return row;
  }

  private ScrollView studentScroll(LinearLayout content) {
    ScrollView scroll = new ScrollView(this);
    scroll.setFillViewport(false);
    scroll.setBackgroundColor(Color.rgb(29, 55, 52));
    scroll.addView(content, new ScrollView.LayoutParams(-1, -2));
    return scroll;
  }

  private void addPoint(SupabaseApi.Student student) {
    if (currentGroup == null) return;
    PointEvent event = new PointEvent();
    event.id = UUID.randomUUID().toString().replace("-", "");
    event.studentId = student.id;
    event.studentName = student.name;
    event.groupId = currentGroup.id;
    event.date = today();
    event.reason = selectedReason;
    event.points = 1;
    pointEvents.add(event);
    saveEvents();
    updateStudentCount(student.id);
    playCelebration();
    syncPending();
  }

  private void undoPoint() {
    if (currentGroup == null) return;
    PointEvent original = null;
    for (int i = pointEvents.size() - 1; i >= 0; i--) {
      PointEvent item = pointEvents.get(i);
      if (item.points > 0 && item.groupId.equals(currentGroup.id) && item.date.equals(today()) && item.reason.equals(selectedReason) && !item.undone) {
        original = item;
        break;
      }
    }
    if (original == null) {
      toast("لا توجد نقطة للتراجع عنها لهذا السبب");
      return;
    }
    original.undone = true;
    PointEvent undo = new PointEvent();
    undo.id = UUID.randomUUID().toString().replace("-", "");
    undo.studentId = original.studentId;
    undo.studentName = original.studentName;
    undo.groupId = original.groupId;
    undo.date = original.date;
    undo.reason = original.reason;
    undo.points = -1;
    pointEvents.add(undo);
    saveEvents();
    updateStudentCount(original.studentId);
    syncPending();
  }

  private int pointCount(String studentId) {
    if (currentGroup == null) return 0;
    int total = 0;
    for (PointEvent item : pointEvents) {
      if (item.studentId.equals(studentId) && item.groupId.equals(currentGroup.id) && item.date.equals(today()) && item.reason.equals(selectedReason)) total += item.points;
    }
    return Math.max(0, total);
  }

  private void updateStudentCount(String studentId) {
    TextView view = countViews.get(studentId);
    if (view != null) view.setText(String.valueOf(pointCount(studentId)));
  }

  private void syncPending() {
    io.execute(() -> {
      boolean changed = false;
      for (PointEvent event : pointEvents) {
        if (event.synced) continue;
        try {
          JSONObject result = api.queuePoint(event.studentId, event.points, "teacher_board_" + event.id, event.date, event.reason);
          if (result.optBoolean("success", false) && !result.optBoolean("blocked", false) && !result.optBoolean("closed", false)) {
            event.synced = true;
            event.error = "";
          } else {
            event.error = result.optString("message", "تعذر تسجيل النقطة");
          }
        } catch (Exception error) {
          event.error = friendly(error);
          break;
        }
        changed = true;
      }
      if (changed) saveEvents();
      int pending = 0;
      String lastError = "";
      for (PointEvent event : pointEvents) if (!event.synced) { pending++; if (!event.error.isEmpty()) lastError = event.error; }
      int finalPending = pending;
      String finalError = lastError;
      main.post(() -> {
        if (!finalError.isEmpty()) status.setText("معلّق " + finalPending + " — " + finalError);
        else if (finalPending > 0) status.setText("جارٍ إرسال " + finalPending + " نقطة…");
      });
    });
  }

  private void readEvents() {
    pointEvents.clear();
    try {
      JSONArray rows = new JSONArray(prefs.getString("point_events", "[]"));
      for (int i = 0; i < rows.length(); i++) pointEvents.add(PointEvent.fromJson(rows.getJSONObject(i)));
    } catch (Exception ignored) {}
  }

  private synchronized void saveEvents() {
    JSONArray rows = new JSONArray();
    int start = Math.max(0, pointEvents.size() - 1500);
    for (int i = start; i < pointEvents.size(); i++) rows.put(pointEvents.get(i).toJson());
    prefs.edit().putString("point_events", rows.toString()).apply();
  }

  private void pickPdf() {
    if (currentGroup == null) { toast("اختر المجموعة أولًا"); return; }
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("application/pdf");
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(intent, OPEN_PDF);
  }

  @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != OPEN_PDF || resultCode != RESULT_OK || data == null || data.getData() == null || currentGroup == null) return;
    Uri uri = data.getData();
    try { getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
    catch (SecurityException ignored) {}
    prefs.edit().putString("pdf_uri_" + currentGroup.id, uri.toString()).apply();
    loadPdf(uri, 0);
  }

  private void openGroupPdf() {
    if (currentGroup == null || pdfView == null) return;
    String saved = prefs.getString("pdf_uri_" + currentGroup.id, "");
    if (saved.isEmpty()) {
      if (!pdfView.isRecycled()) pdfView.recycle();
      pageCount = 0;
      status.setText("لا يوجد كتاب لهذه المجموعة — اضغط إضافة PDF");
      return;
    }
    try { loadPdf(Uri.parse(saved), 0); }
    catch (Exception error) { status.setText("تعذر فتح الكتاب — اختر ملف PDF مرة أخرى"); }
  }

  private void loadPdf(Uri uri, int page) {
    pendingPdfUri = uri;
    status.setText("جارٍ فتح الكتاب…");
    if (!pdfView.isRecycled()) pdfView.recycle();
    pdfView.fromUri(uri)
      .enableSwipe(true)
      .swipeHorizontal(false)
      .enableDoubletap(true)
      .defaultPage(Math.max(0, page))
      .onLoad(count -> {
        pageCount = count;
        pageInput.setText(String.valueOf(Math.max(1, page + 1)));
        updatePageStatus(Math.max(0, page));
      })
      .onPageChange((current, count) -> {
        pageCount = count;
        pageInput.setText(String.valueOf(current + 1));
        updatePageStatus(current);
      })
      .onError(error -> status.setText("تعذر فتح الكتاب — اختر ملف PDF مرة أخرى"))
      .onPageError((number, error) -> status.setText("تعذر تجهيز صفحة " + (number + 1)))
      .enableAnnotationRendering(true)
      .enableAntialiasing(true)
      .spacing(dp(10))
      .autoSpacing(false)
      .pageFitPolicy(FitPolicy.WIDTH)
      .fitEachPage(true)
      .pageSnap(false)
      .pageFling(false)
      .nightMode(false)
      .load();
  }

  private void updatePageStatus(int page) {
    status.setText("صفحة " + (page + 1) + " / " + pageCount + " • PDFium");
  }

  private void goToPage() {
    if (pageCount <= 0 || pdfView == null || pdfView.isRecycled()) return;
    int page;
    try { page = Integer.parseInt(pageInput.getText().toString().trim()); }
    catch (Exception error) { toast("اكتب رقم صفحة صحيح"); return; }
    if (page < 1 || page > pageCount) { toast("رقم الصفحة من 1 إلى " + pageCount); return; }
    pdfView.jumpTo(page - 1, true);
  }

  private void fitPdf() {
    if (!canZoom()) return;
    pdfView.zoomCenteredTo(pdfView.getMinZoom(), new PointF(pdfView.getWidth() / 2f, pdfView.getHeight() / 2f));
    pdfView.loadPages();
  }

  private void changeZoom(float factor) {
    if (!canZoom()) return;
    float target = Math.max(pdfView.getMinZoom(), Math.min(pdfView.getMaxZoom(), pdfView.getZoom() * factor));
    pdfView.zoomCenteredTo(target, new PointF(pdfView.getWidth() / 2f, pdfView.getHeight() / 2f));
    pdfView.loadPages();
  }

  private boolean canZoom() { return pdfView != null && !pdfView.isRecycled() && pdfView.getWidth() > 0; }

  private void playCelebration() {
    if (tone == null) tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 85);
    tone.startTone(ToneGenerator.TONE_PROP_BEEP, 90);
    main.postDelayed(() -> { if (tone != null) tone.startTone(ToneGenerator.TONE_PROP_ACK, 140); }, 100);
  }

  private String today() {
    SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
    format.setTimeZone(TimeZone.getTimeZone("Africa/Cairo"));
    return format.format(new Date());
  }

  private String reasonLabel(String key) {
    for (int i = 0; i < REASON_KEYS.length; i++) if (REASON_KEYS[i].equals(key)) return REASON_LABELS[i];
    return "المشاركة";
  }

  private Button toolbarButton(String label) {
    Button button = new Button(this);
    button.setText(label);
    button.setAllCaps(false);
    button.setTextSize(13);
    button.setMinHeight(0);
    button.setMinimumHeight(0);
    button.setPadding(dp(9), 0, dp(9), 0);
    return button;
  }

  private Button largeButton(String label) {
    Button button = new Button(this);
    button.setText(label);
    button.setAllCaps(false);
    button.setTextSize(20);
    return button;
  }

  private EditText input(String hint) {
    EditText edit = new EditText(this);
    edit.setHint(hint);
    edit.setTextSize(20);
    edit.setGravity(Gravity.CENTER_VERTICAL | Gravity.RIGHT);
    edit.setPadding(dp(18), 0, dp(18), 0);
    return edit;
  }

  private TextView text(String value, float size, int color) {
    TextView view = new TextView(this);
    view.setText(value);
    view.setTextSize(size);
    view.setTextColor(color);
    return view;
  }

  private LinearLayout.LayoutParams matchHeight(int height, int top) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, height);
    p.topMargin = top;
    return p;
  }

  private LinearLayout.LayoutParams matchWrap(int top, int bottom) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.topMargin = top;
    p.bottomMargin = bottom;
    return p;
  }

  private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
  private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }
  private String friendly(Exception error) { return error.getMessage() == null ? "تعذر الاتصال" : error.getMessage(); }

  private void hideSystemBars() {
    getWindow().getDecorView().setSystemUiVisibility(
      View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN |
      View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
      View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    );
  }

  @Override protected void onDestroy() {
    if (pdfView != null && !pdfView.isRecycled()) pdfView.recycle();
    if (tone != null) tone.release();
    io.shutdownNow();
    super.onDestroy();
  }

  private static final class PointEvent {
    String id = "";
    String studentId = "";
    String studentName = "";
    String groupId = "";
    String date = "";
    String reason = "participation";
    String error = "";
    int points;
    boolean synced;
    boolean undone;

    JSONObject toJson() {
      try {
        return new JSONObject().put("id", id).put("studentId", studentId).put("studentName", studentName)
          .put("groupId", groupId).put("date", date).put("reason", reason).put("points", points)
          .put("synced", synced).put("undone", undone).put("error", error);
      } catch (Exception ignored) { return new JSONObject(); }
    }

    static PointEvent fromJson(JSONObject row) {
      PointEvent event = new PointEvent();
      event.id = row.optString("id", "");
      event.studentId = row.optString("studentId", "");
      event.studentName = row.optString("studentName", "طالب");
      event.groupId = row.optString("groupId", "");
      event.date = row.optString("date", "");
      event.reason = row.optString("reason", "participation");
      event.points = row.optInt("points", 0);
      event.synced = row.optBoolean("synced", false);
      event.undone = row.optBoolean("undone", false);
      event.error = row.optString("error", "");
      return event;
    }
  }
}
