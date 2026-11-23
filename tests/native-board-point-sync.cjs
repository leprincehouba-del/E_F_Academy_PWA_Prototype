const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const source = fs.readFileSync(
  "android-teacher-board/app/src/main/java/com/mrmohamed/teacherboard/NativeScreenBoardActivity.java",
  "utf8"
);
function extract(signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error("Missing " + signature);
  const opening = source.indexOf("{", start);
  let depth = 1;
  let end = opening + 1;
  for (; depth > 0; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}") depth--;
  }
  return source.slice(start, end);
}

const harness = `
import java.util.*;

public final class NativePointSyncTest {
  final Deque<Runnable> worker = new ArrayDeque<>();
  final Deque<Runnable> callbacks = new ArrayDeque<>();
  final List<PointEvent> pointEvents = new ArrayList<>();
  final Set<String> recorded = new HashSet<>();
  final Map<String, Integer> sends = new HashMap<>();
  final Executor io = new Executor();
  final Handler main = new Handler();
  final Api api = new Api();
  final Status status = new Status();
  static final String ARREARS_MESSAGE = "arrears";
  boolean blockPositive;
  boolean destroyed, pointSyncRunning, pointSyncRequested, loseResponse;
  Runnable duringSend;

  static class PointEvent {
    String id, studentId = "student", date = "2026-11-19", reason = "participation", error = "", undoOf = "";
    int points = 1;
    boolean synced, rejected;
  }
  class Executor { void execute(Runnable task) { worker.add(task); } }
  class Handler { void post(Runnable task) { callbacks.add(task); } }
  class Status { void setText(String text) {} }
  static class JSONObject {
    final boolean blocked;
    JSONObject(boolean blocked) { this.blocked = blocked; }
    boolean optBoolean(String field, boolean fallback) {
      return field.equals("success") ? !blocked : field.equals("blocked") && blocked;
    }
    String optString(String field, String fallback) { return blocked ? ARREARS_MESSAGE : fallback; }
  }
  class Api {
    JSONObject queuePoint(String student, int points, String key, String date, String reason) {
      sends.merge(key, 1, Integer::sum);
      if (blockPositive && points > 0) return new JSONObject(true);
      recorded.add(key);
      if (duringSend != null) {
        Runnable callback = duringSend;
        duringSend = null;
        callback.run();
      }
      if (loseResponse) {
        loseResponse = false;
        throw new RuntimeException("response lost");
      }
      return new JSONObject(false);
    }
  }
  void saveEvents() {}
  void applyArrearsRefusal(PointEvent event) {}
  String friendly(Exception error) { return error.getMessage(); }

  ${extract("private void syncPending()")}
  ${extract("private void finishPointSync(")}
  ${extract("private static final class PointSyncResult")}

  void tap(int number) {
    PointEvent event = new PointEvent();
    event.id = "tap" + number;
    pointEvents.add(event);
    syncPending();
  }
  void pump() {
    while (!worker.isEmpty() || !callbacks.isEmpty()) {
      if (!worker.isEmpty()) worker.remove().run();
      if (!callbacks.isEmpty()) callbacks.remove().run();
    }
  }
  static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  public static void main(String[] args) {
    NativePointSyncTest board = new NativePointSyncTest();
    board.tap(1);
    board.duringSend = () -> {
      for (int i = 2; i <= 100; i++) board.tap(i);
      check(board.worker.isEmpty(), "rapid taps must coalesce behind one running upload");
    };
    board.pump();
    check(board.recorded.size() == 100, "all rapid taps reached server");
    check(board.pointEvents.stream().allMatch(e -> e.synced), "all 100 taps acknowledged");
    check(board.sends.values().stream().allMatch(count -> count == 1), "confirmed taps sent once");

    board.tap(101);
    board.loseResponse = true;
    board.pump();
    check(!board.pointEvents.get(100).synced, "lost response remains pending");
    board.syncPending();
    board.pump();
    check(board.recorded.size() == 101 && board.sends.get("teacher_board_tap101") == 2,
        "retry uses the original idempotency key");
    check(board.pointEvents.get(100).synced, "retry acknowledges saved point");

    board.blockPositive = true;
    board.tap(102);
    PointEvent undo = new PointEvent();
    undo.id = "undo"; undo.undoOf = "tap102"; undo.points = -1;
    PointEvent deduction = new PointEvent();
    deduction.id = "deduction"; deduction.points = -1;
    board.pointEvents.add(undo);
    board.pointEvents.add(deduction);
    board.syncPending();
    board.pump();
    check(board.pointEvents.get(101).rejected && undo.rejected, "arrears refusal cancels its dependent undo");
    check(board.sends.get("teacher_board_tap102") == 1 && !board.sends.containsKey("teacher_board_undo"),
        "rejected additions and their undos cannot be resent");
    check(deduction.synced, "independent deductions remain available");
    board.blockPositive = false;

    board.tap(103);
    board.duringSend = () -> board.tap(104);
    board.worker.remove().run();
    board.destroyed = true;
    board.pump();
    check(board.worker.isEmpty(), "destroyed activity must not schedule follow-up");
    System.out.println("PASS: 100 rapid APK taps, retry with same key, and safe activity teardown.");
  }
}
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-point-sync-"));
try {
  const file = path.join(dir, "NativePointSyncTest.java");
  fs.writeFileSync(file, harness);
  execFileSync("javac", [file], { stdio: "inherit" });
  execFileSync("java", ["-cp", dir, "NativePointSyncTest"], { stdio: "inherit" });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
