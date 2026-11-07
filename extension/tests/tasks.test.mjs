import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestedStart, normalizePersonalTasks, selectPersonalTasks, PERSONAL_TASKS_QUERY} from '../src/tasks.js';
test('planning includes deadline, skips weekends and handles missing estimates',()=>{
  assert.equal(suggestedStart('2026-11-09',57600),'2026-11-06');
  assert.equal(suggestedStart('2026-11-08',57600),'2026-11-05');
  assert.equal(suggestedStart('2024-03-01',57600),'2024-02-29');
  assert.equal(suggestedStart('2026-11-09',28801),'2026-11-06');
  assert.equal(suggestedStart('2026-11-09',0),null);
});
test('only open Tasks enter planning and unsafe links are removed',()=>{
  const item={id:'1',iid:'1',title:'Task',type:'TASK',state:'opened',reference:'g/p#1',webUrl:'javascript:alert(1)',dueDate:'2026-11-09',timeEstimate:57600};
  const tasks=normalizePersonalTasks([item,{...item,id:'2',type:'ISSUE'},{...item,id:'3',state:'closed'}],{url:'https://gitlab.example.com',projects:[]});
  assert.equal(tasks.length,1); assert.equal(tasks[0].url,null);
  assert.equal(selectPersonalTasks(tasks,'2026-11-06',{status:'ready'}).length,1);
});

test('Issue query uses supported full references for nested projects',()=>{
  assert.ok(!/project\s*\{/.test(PERSONAL_TASKS_QUERY));
  assert.ok(PERSONAL_TASKS_QUERY.includes('reference(full: true)'));
  const item={id:'1',iid:'5',type:'TASK',state:'opened',reference:'group/sub/project#5',webUrl:'https://gitlab.example.com/group/sub/project/-/work_items/5'};
  const config={url:'https://gitlab.example.com',projects:[{url:'group/sub/project',project:'Custom'}]};
  const [task]=normalizePersonalTasks([item],config);
  assert.equal(task.projectPath,'group/sub/project');
  assert.equal(task.project,'Custom');
  assert.deepEqual(normalizePersonalTasks([item],{...config,projects:[{url:'other/project',project:'Other'}]}),[]);
});
