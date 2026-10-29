package com.mrmohamed.teacherboard.nativeclean;

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
import java.nio.charset.StandardCharsets;

final class SupabaseApi {
    static final String URL_BASE = "https://bmnrltyodljgvrcssjhd.supabase.co";
    static final String API_KEY = "sb_publishable_Tk7XuO4BCs9baofK6yjy0Q_LzOKTNVd";
    private static final String PREFS = "student_overlay_auth";
    private static final String ACCESS = "access_token";
    private static final String REFRESH = "refresh_token";
    private final SharedPreferences prefs;

    SupabaseApi(Context context) { prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    boolean isSignedIn() { return !prefs.getString(REFRESH, "").isEmpty(); }
    void signOut() { prefs.edit().clear().apply(); }

    void login(String loginValue, String password) throws Exception {
        String value = loginValue.trim().toLowerCase();
        String[] candidates = value.contains("@")
            ? new String[] { value }
            : new String[] { value + "@efacademy.local", value + "@example.com" };
        Exception lastError = null;
        for (String email : candidates) {
            try {
                JSONObject body = new JSONObject().put("email", email).put("password", password);
                saveTokens(rawObject("POST", "/auth/v1/token?grant_type=password", body, ""));
                return;
            } catch (Exception error) {
                lastError = error;
            }
        }
        throw lastError == null ? new Exception("بيانات الدخول غير صحيحة") : lastError;
    }

    JSONArray groups() throws Exception {
        return (JSONArray) request("GET", "/rest/v1/groups?select=id,name,code&is_active=eq.true&order=name.asc", null);
    }

    JSONArray students(String groupId) throws Exception {
        return (JSONArray) request("GET", "/rest/v1/students?select=id,full_name,group_id&is_active=eq.true&group_id=eq." + groupId + "&order=full_name.asc", null);
    }

    JSONObject queuePoint(String studentId, int points, String eventKey, String date, String reasonKey) throws Exception {
        JSONObject body = new JSONObject().put("p_student_id", studentId).put("p_points", points)
            .put("p_event_key", eventKey).put("p_session_date", date).put("p_reason_key", reasonKey);
        return (JSONObject) request("POST", "/rest/v1/rpc/queue_owner_teacher_board_point_with_reason", body);
    }

    private Object request(String method, String path, JSONObject body) throws Exception {
        try { return raw(method, path, body, prefs.getString(ACCESS, "")); }
        catch (UnauthorizedException first) {
            refresh();
            return raw(method, path, body, prefs.getString(ACCESS, ""));
        }
    }

    private void refresh() throws Exception {
        String token = prefs.getString(REFRESH, "");
        if (token.isEmpty()) throw new Exception("سجّل الدخول من جديد");
        saveTokens(rawObject("POST", "/auth/v1/token?grant_type=refresh_token",
            new JSONObject().put("refresh_token", token), ""));
    }

    private void saveTokens(JSONObject result) throws Exception {
        String access = result.optString("access_token");
        String refresh = result.optString("refresh_token");
        if (access.isEmpty() || refresh.isEmpty()) throw new Exception("تعذر حفظ جلسة الدخول");
        prefs.edit().putString(ACCESS, access).putString(REFRESH, refresh).apply();
    }

    private JSONObject rawObject(String method, String path, JSONObject body, String token) throws Exception {
        Object result = raw(method, path, body, token);
        if (!(result instanceof JSONObject)) throw new Exception("استجابة غير متوقعة من الخادم");
        return (JSONObject) result;
    }

    private Object raw(String method, String path, JSONObject body, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(URL_BASE + path).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(18000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("apikey", API_KEY);
        connection.setRequestProperty("Accept", "application/json");
        if (!token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
        }
        int code = connection.getResponseCode();
        String text = read(code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream());
        connection.disconnect();
        if (code == 401) throw new UnauthorizedException();
        if (code < 200 || code >= 300) {
            String message = text;
            try {
                JSONObject error = new JSONObject(text);
                message = error.optString("message", error.optString("error_description", text));
            } catch (Exception ignored) {}
            throw new Exception(message.isEmpty() ? "تعذر الاتصال بالخادم" : message);
        }
        String trimmed = text.trim();
        if (trimmed.startsWith("[")) return new JSONArray(trimmed);
        return trimmed.isEmpty() ? new JSONObject() : new JSONObject(trimmed);
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
    private static final class UnauthorizedException extends Exception {}
}
