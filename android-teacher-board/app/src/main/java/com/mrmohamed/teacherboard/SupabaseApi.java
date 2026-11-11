package com.mrmohamed.teacherboard;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class SupabaseApi {
  static final class Group {
    final String id;
    final String name;
    Group(String id, String name) { this.id = id; this.name = name; }
  }

  static final class Student {
    final String id;
    final String name;
    Student(String id, String name) { this.id = id; this.name = name; }
  }

  private static final String BASE = "https://bmnrltyodljgvrcssjhd.supabase.co";
  private static final String KEY = "sb_publishable_Tk7XuO4BCs9baofK6yjy0Q_LzOKTNVd";
  private static final String PREFS = "native_screen_auth";
  private final SharedPreferences prefs;
  private String accessToken;
  private String refreshToken;

  SupabaseApi(Context context) {
    prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    accessToken = prefs.getString("access_token", "");
    refreshToken = prefs.getString("refresh_token", "");
  }

  boolean hasSavedSession() { return refreshToken != null && !refreshToken.isEmpty(); }

  void clearSession() {
    accessToken = "";
    refreshToken = "";
    prefs.edit().clear().apply();
  }

  void login(String phone, String password) throws Exception {
    String normalized = phone == null ? "" : phone.replaceAll("[^0-9]", "");
    if (normalized.isEmpty() || password == null || password.isEmpty()) {
      throw new IllegalArgumentException("أدخل رقم الهاتف وكلمة المرور");
    }
    Exception last = null;
    for (String domain : new String[]{"efacademy.local", "example.com"}) {
      try {
        JSONObject body = new JSONObject()
          .put("email", normalized + "@" + domain)
          .put("password", password);
        JSONObject response = requestJson("POST", BASE + "/auth/v1/token?grant_type=password", body, null);
        saveSession(response);
        verifyScreenRole();
        return;
      } catch (Exception error) {
        last = error;
        clearSession();
      }
    }
    throw new Exception(last == null ? "بيانات الدخول غير صحيحة" : friendly(last));
  }

  void restoreSession() throws Exception {
    if (!hasSavedSession()) throw new Exception("لا توجد جلسة محفوظة");
    JSONObject response = requestJson("POST", BASE + "/auth/v1/token?grant_type=refresh_token",
      new JSONObject().put("refresh_token", refreshToken), null);
    saveSession(response);
    verifyScreenRole();
  }

  List<Group> groups() throws Exception {
    JSONArray rows = authorizedArray("GET", BASE + "/rest/v1/groups?select=id,name,code&is_active=eq.true&order=name.asc", null);
    List<Group> result = new ArrayList<>();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      String name = row.optString("name", "").trim();
      if (name.isEmpty()) name = row.optString("code", "مجموعة");
      result.add(new Group(row.getString("id"), name));
    }
    return result;
  }

  List<Student> students(String groupId) throws Exception {
    String encoded = URLEncoder.encode(groupId, StandardCharsets.UTF_8.name());
    JSONArray rows = authorizedArray("GET", BASE + "/rest/v1/students?select=id,full_name&is_active=eq.true&group_id=eq." + encoded + "&order=full_name.asc", null);
    List<Student> result = new ArrayList<>();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject row = rows.getJSONObject(i);
      result.add(new Student(row.getString("id"), row.optString("full_name", "طالب")));
    }
    return result;
  }

  JSONObject queuePoint(String studentId, int points, String eventKey, String sessionDate, String reasonKey) throws Exception {
    JSONObject body = new JSONObject()
      .put("p_student_id", studentId)
      .put("p_points", points)
      .put("p_event_key", eventKey)
      .put("p_session_date", sessionDate)
      .put("p_reason_key", reasonKey);
    return authorizedObject("POST", BASE + "/rest/v1/rpc/queue_screen_teacher_board_point_with_reason", body);
  }

  private void verifyScreenRole() throws Exception {
    JSONArray rows = authorizedArray("GET", BASE + "/rest/v1/user_profiles?select=full_name,role,is_active&id=eq." + userId(), null);
    if (rows.length() != 1) throw new Exception("تعذر قراءة حساب الشاشة");
    JSONObject profile = rows.getJSONObject(0);
    String role = profile.optString("role", "");
    if (!profile.optBoolean("is_active", false) || !("screen".equals(role) || "owner".equals(role))) {
      throw new Exception("هذا الحساب غير مصرح له بفتح السبورة");
    }
  }

  private String userId() throws Exception {
    String value = prefs.getString("user_id", "");
    if (value == null || value.isEmpty()) throw new Exception("جلسة الدخول غير مكتملة");
    return value;
  }

  private void saveSession(JSONObject response) throws Exception {
    accessToken = response.optString("access_token", "");
    refreshToken = response.optString("refresh_token", "");
    String userId = response.optJSONObject("user") == null ? "" : response.optJSONObject("user").optString("id", "");
    if (accessToken.isEmpty() || refreshToken.isEmpty() || userId.isEmpty()) throw new Exception("استجابة الدخول غير مكتملة");
    prefs.edit().putString("access_token", accessToken).putString("refresh_token", refreshToken).putString("user_id", userId).apply();
  }

  private JSONArray authorizedArray(String method, String url, JSONObject body) throws Exception {
    Object value = authorized(method, url, body);
    if (!(value instanceof JSONArray)) throw new Exception("استجابة غير متوقعة من الخادم");
    return (JSONArray) value;
  }

  private JSONObject authorizedObject(String method, String url, JSONObject body) throws Exception {
    Object value = authorized(method, url, body);
    if (!(value instanceof JSONObject)) throw new Exception("استجابة غير متوقعة من الخادم");
    return (JSONObject) value;
  }

  private Object authorized(String method, String url, JSONObject body) throws Exception {
    try {
      return request(method, url, body, accessToken);
    } catch (Unauthorized error) {
      restoreSession();
      return request(method, url, body, accessToken);
    }
  }

  private JSONObject requestJson(String method, String url, JSONObject body, String bearer) throws Exception {
    Object value = request(method, url, body, bearer);
    if (!(value instanceof JSONObject)) throw new Exception("استجابة غير متوقعة من الخادم");
    return (JSONObject) value;
  }

  private Object request(String method, String url, JSONObject body, String bearer) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
    connection.setConnectTimeout(15000);
    connection.setReadTimeout(20000);
    connection.setRequestMethod(method);
    connection.setRequestProperty("apikey", KEY);
    connection.setRequestProperty("Accept", "application/json");
    if (bearer != null && !bearer.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + bearer);
    if (body != null) {
      connection.setDoOutput(true);
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
      try (OutputStream output = connection.getOutputStream()) {
        output.write(body.toString().getBytes(StandardCharsets.UTF_8));
      }
    }
    int code = connection.getResponseCode();
    String text = read(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream());
    connection.disconnect();
    if (code == 401) throw new Unauthorized();
    if (code < 200 || code >= 300) {
      String message = text;
      try {
        JSONObject error = new JSONObject(text);
        message = error.optString("message", error.optString("msg", text));
      } catch (Exception ignored) {}
      throw new Exception(message == null || message.isEmpty() ? "تعذر الاتصال بالخادم" : message);
    }
    if (text == null || text.trim().isEmpty()) return new JSONObject();
    String trimmed = text.trim();
    return trimmed.startsWith("[") ? new JSONArray(trimmed) : new JSONObject(trimmed);
  }

  private static String read(InputStream input) throws Exception {
    if (input == null) return "";
    StringBuilder result = new StringBuilder();
    try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) result.append(line);
    }
    return result.toString();
  }

  private static String friendly(Exception error) {
    String message = error.getMessage();
    if (message == null || message.isEmpty()) return "تعذر تسجيل الدخول";
    if (message.contains("Invalid login credentials")) return "بيانات الدخول غير صحيحة";
    return message;
  }

  private static final class Unauthorized extends Exception {}
}
