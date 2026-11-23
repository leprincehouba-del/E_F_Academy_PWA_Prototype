const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const acorn=require('acorn');
const source=fs.readFileSync('teacher-reader.js','utf8');
const body=acorn.parse(source,{ecmaVersion:'latest'}).body[0].expression.callee.body.body;
const fn=name=>{const n=body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(n.start,n.end)};
let seq=0,saves=0,syncs=0;
const state={pointEvents:[]},group={id:'g'},reason={value:'participation'};
const context={state,students:[{id:'s',name:'Synthetic student',dueSessions:3}],selectedGroup:()=>group,selectedPointReason:()=>reason.value,el:()=>({value:'2026-11-19'}),makeId:()=>String(++seq),persistPointEvents(){saves++},renderStudents(){},syncPoints(){syncs++},showToast(){throw Error('unexpected refusal')},document:{querySelector(){return null}},CSS:{escape:x=>x},setTimeout(){},Date};
context.currentPointEvents=()=>state.pointEvents.filter(e=>e.groupId===group.id&&e.sessionDate==='2026-11-19');
vm.createContext(context);vm.runInContext(fn('removePoint')+'\n'+fn('pointCount')+'\nthis.remove=removePoint;this.count=pointCount;',context);
context.remove('s');assert.equal(context.count('s'),-1,'minus at zero must create a negative point');
context.remove('s');assert.equal(context.count('s'),-2,'repeated deductions must remain negative');
assert.ok(state.pointEvents.every(e=>e.action==='deduction'&&e.points===-1&&!e.undoOf));
state.pointEvents.push({id:'positive',studentId:'s',groupId:'g',sessionDate:'2026-11-19',reasonKey:'participation',points:4});
assert.equal(context.count('s'),2);context.remove('s');assert.equal(context.count('s'),1,'2 minus 1 remains 1');
reason.value='homework';assert.equal(context.count('s'),0);context.remove('s');assert.equal(context.count('s'),-1);
reason.value='participation';assert.equal(context.count('s'),1,'changing reasons preserves previous deductions');
group.id='g2';assert.equal(context.count('s'),0);context.remove('s');assert.equal(context.count('s'),-1);
assert.equal(saves,5);assert.equal(syncs,5);assert.equal(new Set(state.pointEvents.map(e=>e.id)).size,state.pointEvents.length);
console.log('PASS: web direct deductions at zero, repeated negatives, positive-to-negative, isolated reasons/groups, persisted and queued once per tap.');
// Run the production Java ledger methods without Android UI dependencies.
const java=fs.readFileSync('android-teacher-board/app/src/main/java/com/mrmohamed/teacherboard/NativeScreenBoardActivity.java','utf8');
const method=name=>{const start=java.search(new RegExp('  private (?:void|int) '+name+'\\('));assert.ok(start>=0);let i=java.indexOf('{',start),depth=1;for(i++;depth;i++){if(java[i]==='{')depth++;if(java[i]==='}')depth--;}return java.slice(start,i)};
const harness=`import java.util.*;
class SupabaseApi {static class Group {String id;Group(String id){this.id=id;}} static class Student {String id,name;int dueSessions=3;Student(String id){this.id=id;name="Synthetic";}boolean awardsBlocked(){return dueSessions>=3;}}}
public class NativeDeductionTest {
 static class PointEvent {String id,studentId,studentName,groupId,date,reason;int points;boolean undone,rejected;}
 List<PointEvent> pointEvents=new ArrayList<>(); SupabaseApi.Group currentGroup=new SupabaseApi.Group("g"); String selectedReason="participation";
 static final String ARREARS_MESSAGE="arrears"; String toastMessage;
 String today(){return "2026-11-19";} void saveEvents(){} void updateStudentCount(String id){} void syncPending(){} void playCelebration(){} void toast(String message){toastMessage=message;}
 ${method('addPoint')} ${method('removePoint')} ${method('pointCount')}
 void check(int expected){if(pointCount("s")!=expected)throw new AssertionError("expected "+expected+" got "+pointCount("s"));}
 public static void main(String[] args){NativeDeductionTest t=new NativeDeductionTest();SupabaseApi.Student s=new SupabaseApi.Student("s");t.removePoint(s);t.check(-1);t.removePoint(s);t.check(-2);t.addPoint(s);t.check(-2);if(!ARREARS_MESSAGE.equals(t.toastMessage))throw new AssertionError("blocked positive should explain why");s.dueSessions=2;t.addPoint(s);t.addPoint(s);t.addPoint(s);t.addPoint(s);t.check(2);t.removePoint(s);t.check(1);t.selectedReason="homework";t.check(0);t.removePoint(s);t.check(-1);t.selectedReason="participation";t.check(1);t.currentGroup=new SupabaseApi.Group("g2");t.check(0);t.removePoint(s);t.check(-1);System.out.println("PASS: production native ledger deductions at zero, repeated negatives and isolated groups/reasons.");}
}`;
if(cp.spawnSync('javac',['-version']).error){if(process.env.CI)throw Error('javac required in CI');console.log('Native Java behavioral test deferred to GitHub Java runtime.');}
else {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'board-deductions-'));try{const file=path.join(dir,'NativeDeductionTest.java');fs.writeFileSync(file,harness);cp.execFileSync('javac',[file]);console.log(cp.execFileSync('java',['-cp',dir,'NativeDeductionTest'],{encoding:'utf8'}).trim());}finally{fs.rmSync(dir,{recursive:true,force:true})}}
