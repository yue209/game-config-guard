import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRules, validatePatch, executeClaim, read_config, validate_config, find_references, propose_patch, apply_patch, run_preview } from '../worker/index.js';

const normal = { tasks:[{task_id:'T001',title:'完成一次训练',reward_id:'R001',claim_limit:1}], rewards:[{reward_id:'R001',item_id:'GOLD',amount:100}], items:[{item_id:'GOLD',name:'金币'}] };

test('正确配置通过规则检查', () => assert.equal(validateRules(normal).length, 0));
test('检测重复、缺失引用和负数奖励', () => {
  const bad = structuredClone(normal);
  bad.tasks.push({task_id:'T001',title:'完成一次训练',reward_id:'R404',claim_limit:1});
  bad.rewards.push({reward_id:'R002',item_id:'GOLD',amount:-5});
  const codes = validateRules(bad).map(x => x.code);
  assert.ok(codes.includes('DUPLICATE_ID'));
  assert.ok(codes.includes('MISSING_REWARD_REF'));
  assert.ok(codes.includes('INVALID_AMOUNT'));
});
test('补丁受字段白名单和类型约束', () => {
  assert.equal(validatePatch(normal,{table:'rewards',id:'R001',field:'amount',value:100}).ok,true);
  assert.equal(validatePatch(normal,{table:'rewards',id:'R001',field:'item_id',value:'GOLD'}).ok,false);
  assert.equal(validatePatch(normal,{table:'rewards',id:'R404',field:'amount',value:100}).ok,false);
});
test('预览沿引用发奖并限制重复领取', () => {
  const first = executeClaim(normal,{completed:true,claims:0,balance:0},'T001');
  assert.equal(first.state.balance,100);
  assert.throws(()=>executeClaim(normal,first.state,'T001'),/领取上限/);
});
test('无效引用不会回退到默认奖励', () => {
  const bad=structuredClone(normal); bad.tasks[0].reward_id='R404';
  assert.throws(()=>executeClaim(bad,{completed:true,claims:0,balance:0},'T001'),/不存在/);
});
test('六个 Agent 工具形成真实闭环', () => {
  const loaded = read_config(normal);
  assert.notEqual(loaded, normal);
  assert.equal(validate_config(loaded).length, 0);
  assert.deepEqual(find_references(loaded, 'R001').map(x => x.task_id), ['T001']);
  const proposal = propose_patch(loaded,{table:'rewards',id:'R001',field:'amount',value:120,basis:'测试需求'});
  assert.equal(proposal.ok,true);
  const applied = apply_patch(loaded,proposal.patch);
  const completed = run_preview(applied.config,{completed:false,claims:0,balance:0},'T001','complete');
  const claimed = run_preview(applied.config,completed.state,'T001','claim');
  assert.equal(claimed.state.balance,120);
});
