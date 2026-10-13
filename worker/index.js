const ALLOWED_PATCHES = { rewards: ['amount'], tasks: ['claim_limit'] };
const ID_FIELD = { tasks: 'task_id', rewards: 'reward_id', items: 'item_id' };
const REQUIRED = { tasks: ['task_id','title','reward_id','claim_limit'], rewards: ['reward_id','item_id','amount'], items: ['item_id','name'] };

const issue = (code, kind, severity, message, table, id, field, current, basis, suggestion = null) => ({
  id: `${code}:${table || 'project'}:${id || '-'}:${field || '-'}`,
  code, kind, severity, message, location: { table, id, field }, current, basis, suggestion
});

export function validateRules(config) {
  const issues = [];
  for (const [table, fields] of Object.entries(REQUIRED)) {
    const rows = config?.[table];
    if (!Array.isArray(rows)) { issues.push(issue('MISSING_FILE','rule','blocker',`缺少 ${table}.csv`,table,null,null,null,'三张配置表必须齐全')); continue; }
    if (!rows.length) { issues.push(issue('EMPTY_FILE','rule','blocker',`${table}.csv 没有数据`,table,null,null,null,'配置表不能为空')); continue; }
    for (const field of fields) if (!(field in rows[0])) issues.push(issue('MISSING_FIELD','rule','blocker',`缺少字段 ${field}`,table,null,field,null,`${table}.csv 字段契约`));
    const key = ID_FIELD[table], seen = new Set();
    rows.forEach(row => { const id = String(row[key] ?? ''); if (seen.has(id)) issues.push(issue('DUPLICATE_ID','rule','blocker',`${key} 重复`,table,id,key,id,'各表主键不能重复')); seen.add(id); });
  }
  if (!Array.isArray(config?.tasks) || !Array.isArray(config?.rewards) || !Array.isArray(config?.items)) return issues;
  const rewardIds = new Set(config.rewards.map(x => String(x.reward_id)));
  const itemIds = new Set(config.items.map(x => String(x.item_id)));
  for (const row of config.tasks) {
    const id = String(row.task_id ?? '');
    if (!rewardIds.has(String(row.reward_id))) issues.push(issue('MISSING_REWARD_REF','rule','blocker','任务引用的奖励不存在','tasks',id,'reward_id',row.reward_id,'奖励引用必须存在；无法唯一确定时禁止自动创建'));
    const limit = Number(row.claim_limit);
    if (!Number.isInteger(limit) || limit <= 0) issues.push(issue('INVALID_CLAIM_LIMIT','rule','blocker','领取次数必须为正整数','tasks',id,'claim_limit',row.claim_limit,'claim_limit 为正整数'));
    if (row.title !== '完成一次训练') issues.push(issue('UNSUPPORTED_TASK','rule','blocker','第一版不支持该任务行为','tasks',id,'title',row.title,'第一版只支持“完成一次训练”'));
  }
  for (const row of config.rewards) {
    const id = String(row.reward_id ?? ''), amount = Number(row.amount);
    if (!itemIds.has(String(row.item_id))) issues.push(issue('MISSING_ITEM_REF','rule','blocker','奖励引用的物品不存在','rewards',id,'item_id',row.item_id,'物品引用必须存在'));
    if (!Number.isInteger(amount) || amount <= 0) issues.push(issue('INVALID_AMOUNT','rule','blocker','奖励数量必须为正整数','rewards',id,'amount',row.amount,'奖励数量为正整数'));
    if (row.item_id === 'GOLD' && Number.isInteger(amount) && amount > 500) issues.push(issue('GOLD_LIMIT','rule','blocker','金币奖励超过项目上限','rewards',id,'amount',row.amount,'模拟项目规定：单任务金币奖励不得超过 500'));
  }
  return issues;
}

export function validatePatch(config, patch) {
  if (!patch || !ALLOWED_PATCHES[patch.table]?.includes(patch.field)) return { ok:false, reason:'字段不在可修改白名单中' };
  const key = ID_FIELD[patch.table], rows = config?.[patch.table];
  if (!Array.isArray(rows)) return { ok:false, reason:'目标配置表不存在' };
  const row = rows.find(x => String(x[key]) === String(patch.id));
  if (!row) return { ok:false, reason:'目标记录不存在' };
  const value = Number(patch.value);
  if (!Number.isInteger(value) || value <= 0) return { ok:false, reason:'修改值必须为正整数' };
  if (patch.table === 'rewards' && patch.field === 'amount' && row.item_id === 'GOLD' && value > 500) return { ok:false, reason:'金币奖励不能超过 500' };
  return { ok:true, before:row[patch.field], normalized:value };
}

export function applyPatch(config, patch) {
  const checked = validatePatch(config, patch);
  if (!checked.ok) throw new Error(checked.reason);
  const copy = structuredClone(config), key = ID_FIELD[patch.table];
  copy[patch.table].find(x => String(x[key]) === String(patch.id))[patch.field] = checked.normalized;
  return { config:copy, diff:{ table:patch.table, id:String(patch.id), field:patch.field, before:checked.before, after:checked.normalized, basis:patch.basis || '已确认需求' } };
}

export function executeClaim(config, state, taskId) {
  const task = config?.tasks?.find(x => String(x.task_id) === String(taskId));
  if (!task) throw new Error(`任务 ${taskId} 不存在`);
  if (!state.completed) throw new Error('请先完成训练');
  const reward = config.rewards?.find(x => String(x.reward_id) === String(task.reward_id));
  if (!reward) throw new Error(`奖励 ${task.reward_id} 不存在，已阻止发奖`);
  const item = config.items?.find(x => String(x.item_id) === String(reward.item_id));
  if (!item) throw new Error(`物品 ${reward.item_id} 不存在，已阻止发奖`);
  const amount = Number(reward.amount), limit = Number(task.claim_limit);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('奖励数量无效，已阻止发奖');
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('领取次数无效，已阻止发奖');
  if (state.claims >= limit) throw new Error('已达到领取上限');
  const next = { ...state, claims:state.claims + 1, balance:state.balance + (reward.item_id === 'GOLD' ? amount : 0) };
  return { state:next, reward:{ reward_id:reward.reward_id, item_id:item.item_id, item_name:item.name, amount } };
}

// Agent tools: these are real backend functions. The model can propose intent,
// but deterministic code owns reads, validation, impact analysis and writes.
export function read_config(config) {
  if (!config || typeof config !== 'object') throw new Error('配置不存在');
  return structuredClone({ tasks:config.tasks, rewards:config.rewards, items:config.items });
}

export function validate_config(config) { return validateRules(config); }

export function find_references(config, rewardId) {
  return (config?.tasks || []).filter(row => String(row.reward_id) === String(rewardId)).map(row => ({ task_id:String(row.task_id), title:row.title, field:'reward_id' }));
}

export function propose_patch(config, patch) {
  const checked = validatePatch(config, patch);
  if (!checked.ok) return { ok:false, reason:checked.reason, patch:null, diff:null };
  return { ok:true, patch:{ ...patch, value:checked.normalized }, diff:{ table:patch.table, id:String(patch.id), field:patch.field, before:checked.before, after:checked.normalized, basis:patch.basis || '已确认需求' } };
}

export function apply_patch(config, patch) { return applyPatch(config, patch); }

export function run_preview(config, state, taskId, action = 'claim') {
  if (action === 'complete') return { state:{ ...state, completed:true }, event:{ type:'task_completed', task_id:String(taskId) } };
  return executeClaim(config, state, taskId);
}

function contractIssues(config, contract) {
  if (!contract) return [];
  const task = config.tasks?.find(x => x.title === contract.taskTitle);
  if (!task) return [];
  const reward = config.rewards?.find(x => String(x.reward_id) === String(task.reward_id));
  const out = [];
  if (reward && reward.item_id === contract.itemId && Number(reward.amount) !== Number(contract.amount)) {
    const patch = { table:'rewards', id:String(reward.reward_id), field:'amount', value:Number(contract.amount), basis:`内置演示需求契约：${contract.amount} 金币` };
    out.push(issue('CONTRACT_AMOUNT_MISMATCH','contract','warning','奖励数量与已确认需求不一致','rewards',reward.reward_id,'amount',reward.amount,patch.basis,patch));
  }
  if (Number(task.claim_limit) !== Number(contract.claimLimit)) {
    const patch = { table:'tasks', id:String(task.task_id), field:'claim_limit', value:Number(contract.claimLimit), basis:`内置演示需求契约：限领 ${contract.claimLimit} 次` };
    out.push(issue('CONTRACT_LIMIT_MISMATCH','contract','warning','领取次数与已确认需求不一致','tasks',task.task_id,'claim_limit',task.claim_limit,patch.basis,patch));
  }
  return out;
}

async function modelReview(env, requirement, config) {
  if (!env.DASHSCOPE_API_KEY) return { state:'unavailable', issues:[], message:'未配置 DASHSCOPE_API_KEY，Qwen-Plus 需求核对未运行' };
  const schema = { type:'object', additionalProperties:false, properties:{ needs_clarification:{type:'boolean'}, clarification_question:{type:['string','null']}, findings:{type:'array',items:{type:'object',additionalProperties:false,properties:{message:{type:'string'},table:{type:'string',enum:['tasks','rewards']},id:{type:'string'},field:{type:'string',enum:['amount','claim_limit']},current:{type:['number','string']},suggested_value:{type:['number','null']},basis:{type:'string'}},required:['message','table','id','field','current','suggested_value','basis']}}}, required:['needs_clarification','clarification_question','findings'] };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 18000);
  try {
    const base = (env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/,'');
    const response = await fetch(`${base}/chat/completions`, { method:'POST', signal:controller.signal, headers:{'content-type':'application/json','authorization':`Bearer ${env.DASHSCOPE_API_KEY}`}, body:JSON.stringify({ model:env.QWEN_MODEL || 'qwen-plus', enable_thinking:false, messages:[{role:'system',content:'你是游戏配置语义审查器。只比较用户需求和给定配置。当需求已经明确给出奖励数量或领取次数时，发现配置不一致必须直接返回 finding 和 suggested_value；这是供用户随后审查的候选修改，不要再次询问是否确认。只有需求本身缺少完成检查所必需的明确数值时，才设置 needs_clarification=true。禁止猜测缺失数值，不要建议创建不存在的记录。只返回符合 schema 的内容。'},{role:'user',content:JSON.stringify({ requirement, config })}], response_format:{ type:'json_schema', json_schema:{ name:'config_review', strict:true, schema } } }) });
    if (!response.ok) throw new Error(`DashScope API ${response.status}`);
    const data = await response.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    if (parsed.needs_clarification) return { state:'needs_input', issues:[], message:parsed.clarification_question || '请补充明确的奖励数量' };
    const issues = [];
    for (const finding of parsed.findings || []) {
      const patch = finding.suggested_value == null ? null : { table:finding.table, id:finding.id, field:finding.field, value:finding.suggested_value, basis:finding.basis };
      const valid = patch ? validatePatch(config, patch) : {ok:false};
      issues.push(issue('AI_SEMANTIC_MISMATCH','semantic',valid.ok?'warning':'blocker',finding.message,finding.table,finding.id,finding.field,finding.current,finding.basis,valid.ok?patch:null));
    }
    return { state:'connected', issues, message:'AI 需求核对完成' };
  } catch (error) {
    return { state:'error', issues:[], message:error.name === 'AbortError' ? '模型调用超时，规则检查结果已保留' : '模型调用失败，规则检查结果已保留' };
  } finally { clearTimeout(timer); }
}

async function checkRequest(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error:'请求体不是有效 JSON' },400); }
  if (!body || typeof body.requirement !== 'string' || !body.config) return json({ error:'缺少 requirement 或 config' },400);
  const toolTrace = [];
  const config = read_config(body.config);
  toolTrace.push({ tool:'read_config', input:{ tables:['tasks','rewards','items'] }, result:{ tasks:config.tasks?.length || 0, rewards:config.rewards?.length || 0, items:config.items?.length || 0 } });
  const ruleIssues = validate_config(config);
  toolTrace.push({ tool:'validate_config', input:{ checks:['duplicate_id','references','positive_integer','gold_limit','task_type'] }, result:{ issue_count:ruleIssues.length } });
  const demoIssues = contractIssues(config, body.demoContract);
  const clarification = body.demoClarification ? { required:true, question:'当前奖励为 10 金币，你希望调整到多少？', source:'builtin_demo_metadata' } : null;
  const ai = clarification ? { state:env.DASHSCOPE_API_KEY?'skipped':'unavailable', issues:[], message:'内置模糊需求样例需要补充明确数量' } : await modelReview(env, body.requirement, config);
  const semantic = [...demoIssues];
  for (const item of ai.issues) if (!semantic.some(x => x.location.table===item.location.table && x.location.id===item.location.id && x.location.field===item.location.field)) semantic.push(item);
  for (const item of semantic) {
    if (item.location.table === 'rewards' && item.location.id) {
      const refs = find_references(config, item.location.id);
      toolTrace.push({ tool:'find_references', input:{ reward_id:item.location.id }, result:{ count:refs.length, tasks:refs.map(x => x.task_id) } });
      item.references = refs;
    }
    if (item.suggestion) {
      const proposed = propose_patch(config, item.suggestion);
      toolTrace.push({ tool:'propose_patch', input:{ table:item.suggestion.table, id:item.suggestion.id, field:item.suggestion.field, value:item.suggestion.value }, result:proposed.ok?'valid':proposed.reason });
      item.suggestion = proposed.ok ? proposed.patch : null;
      item.diff = proposed.diff;
    }
  }
  return json({ ruleIssues, semanticIssues:semantic, ai, clarification, toolTrace, checkedAt:new Date().toISOString() });
}

async function applyRequest(request) {
  let body; try { body = await request.json(); } catch { return json({error:'请求体不是有效 JSON'},400); }
  let config; try { config = read_config(body.config); } catch (error) { return json({error:error.message},400); }
  const diffs = [], toolTrace = [];
  for (const patch of body.patches || []) {
    const proposed = propose_patch(config, patch);
    toolTrace.push({ tool:'propose_patch', input:{table:patch.table,id:patch.id,field:patch.field,value:patch.value}, result:proposed.ok?'valid':proposed.reason });
    if (!proposed.ok) return json({ error:`无效修改：${proposed.reason}`, toolTrace },422);
    const applied = apply_patch(config, proposed.patch);
    config = applied.config; diffs.push(applied.diff);
    toolTrace.push({ tool:'apply_patch', input:{table:patch.table,id:patch.id,field:patch.field}, result:{before:applied.diff.before,after:applied.diff.after} });
  }
  return json({ config, diffs, toolTrace });
}

async function previewRequest(request) {
  let body; try { body = await request.json(); } catch { return json({error:'请求体不是有效 JSON'},400); }
  try {
    const result = run_preview(read_config(body.config), body.state, body.taskId, body.action);
    return json({ ...result, toolTrace:[{tool:'run_preview',input:{task_id:body.taskId,action:body.action,source:body.source},result:result.reward || result.event}] });
  } catch (error) { return json({ error:error.message, toolTrace:[{tool:'run_preview',input:{task_id:body.taskId,action:body.action,source:body.source},result:'blocked'}] },422); }
}

const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});

const page = String.raw`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="游戏配置检查与修复 Agent"><title>TACTICAL CONFIG / 战术配置台</title>
<style>
:root{--bg:#0f1923;--panel:#14222d;--panel2:#182a37;--red:#ff4655;--cream:#ece8e1;--muted:#83929d;--line:#30414d;--cyan:#5ed4d1;--amber:#ffc15a;--green:#61d095;--cut:10px}*{box-sizing:border-box}html{background:var(--bg);color:var(--cream);font-family:Inter,"PingFang SC","Microsoft YaHei",sans-serif}body{margin:0;min-height:100vh;background:linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),radial-gradient(circle at 80% 15%,rgba(255,70,85,.09),transparent 28%),#0f1923;background-size:40px 40px,40px 40px,auto;letter-spacing:.02em}body:before{content:"";position:fixed;inset:76px 0 auto;height:1px;background:linear-gradient(90deg,transparent,var(--red),transparent);opacity:.5;pointer-events:none}button,textarea,input{font:inherit}.top{height:76px;display:flex;align-items:center;border-bottom:1px solid var(--line);padding:0 30px;background:rgba(10,19,27,.94);position:sticky;top:0;z-index:20}.brand{display:flex;align-items:center;gap:14px;min-width:310px}.mark{width:38px;height:38px;background:var(--red);clip-path:polygon(0 0,100% 0,100% 68%,70% 100%,0 100%);display:grid;place-items:center;color:#fff;font-weight:900}.brand b{font:800 15px/1.1 Impact,"Arial Narrow",sans-serif;letter-spacing:1.8px}.brand small{display:block;color:var(--muted);font-size:9px;margin-top:4px;letter-spacing:1px}.nav{display:flex;height:100%;gap:4px}.nav button{border:0;background:none;color:#8ea0aa;font-size:11px;padding:0 18px;border-bottom:2px solid transparent}.nav button.active{color:var(--cream);border-color:var(--red)}.system{margin-left:auto;display:flex;align-items:center;gap:16px;font-size:10px;color:var(--muted)}.system b{color:var(--cream)}.status-dot{width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 10px var(--amber)}.status-dot.on{background:var(--green);box-shadow:0 0 10px var(--green)}.hero{padding:25px 30px 18px;display:flex;align-items:end;justify-content:space-between}.hero h1{font:900 clamp(28px,3vw,48px)/.96 Impact,"Arial Narrow",sans-serif;letter-spacing:2px;margin:0;text-transform:uppercase}.hero h1 em{font-style:normal;color:var(--red)}.hero p{color:var(--muted);font-size:11px;max-width:560px;line-height:1.65}.statebar{display:flex;align-items:center;gap:10px;border:1px solid var(--line);padding:9px 12px;background:#101c25;clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)}.statebar span{font-size:9px;color:var(--muted);text-transform:uppercase}.statebar b{font-size:11px;color:var(--amber)}.grid{display:grid;grid-template-columns:minmax(290px,.88fr) minmax(420px,1.3fr) minmax(330px,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin:0 24px 24px}.col{background:rgba(15,25,35,.97);min-height:720px;padding:18px;position:relative}.col:after{content:attr(data-code);position:absolute;right:12px;top:9px;font:700 9px monospace;color:#3f515c;letter-spacing:2px}.section-head{display:flex;align-items:center;gap:9px;padding-bottom:13px;border-bottom:1px solid var(--line);margin-bottom:14px}.section-head .num{font:800 11px monospace;color:var(--red)}h2{font-size:14px;margin:0;letter-spacing:.7px}.section-head small{display:block;color:var(--muted);font-size:9px;margin-top:3px}.box{border:1px solid var(--line);background:rgba(24,42,55,.62);margin-bottom:11px;position:relative}.box:before{content:"";position:absolute;right:-1px;top:-1px;border-top:12px solid var(--bg);border-left:12px solid transparent}.box-head{padding:10px 11px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;font-size:10px;font-weight:700;text-transform:uppercase}.box-head span:last-child{color:var(--muted);font-size:8px;font-family:monospace}.box-body{padding:11px}.req{width:100%;min-height:78px;resize:vertical;border:0;border-left:2px solid var(--red);background:#0e1821;color:var(--cream);padding:11px;outline:none;font-size:11px;line-height:1.65}.preset-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.btn{border:1px solid var(--line);color:var(--cream);background:#172733;padding:9px 10px;font-size:9px;font-weight:750;letter-spacing:.4px;cursor:pointer;clip-path:polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,0 100%)}.btn:hover{border-color:#687985;background:#203441}.btn.red{background:var(--red);border-color:var(--red);color:white}.btn.red:hover{background:#ff5c69}.btn.ghost{background:transparent}.btn:disabled{opacity:.38;cursor:not-allowed}.file-drop{display:block;border:1px dashed #4a5d68;padding:13px;text-align:center;color:#96a5ad;font-size:9px;cursor:pointer}.file-drop strong{display:block;color:var(--cream);font-size:10px;margin-bottom:3px}.file-pills{display:flex;gap:5px;margin-top:8px;flex-wrap:wrap}.file-pill{padding:5px 7px;background:#12202a;border-left:2px solid var(--green);font:8px monospace;color:#9eacb4}.tabs{display:flex;border-bottom:1px solid var(--line)}.tabs button{flex:1;border:0;background:none;color:var(--muted);padding:8px;font-size:9px}.tabs button.active{color:var(--cream);background:#1b2d39;border-bottom:1px solid var(--red)}.table-wrap{overflow:auto;max-height:150px}.data-table{border-collapse:collapse;width:100%;font:8px monospace}.data-table th,.data-table td{border-bottom:1px solid #263945;padding:6px;text-align:left;white-space:nowrap}.data-table th{color:var(--muted)}.rules{margin:0;padding-left:15px;color:#9cabba;font-size:9px;line-height:1.75}.main-action{width:100%;padding:12px;margin-top:8px;text-transform:uppercase;letter-spacing:1.3px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin-bottom:10px}.metric{background:#111e27;padding:10px}.metric b{display:block;font:800 18px Impact,sans-serif}.metric small{font-size:8px;color:var(--muted)}.metric.block b{color:var(--red)}.metric.warn b{color:var(--amber)}.metric.ok b{color:var(--green)}.agent-banner{padding:10px;border-left:2px solid var(--amber);background:#172630;margin-bottom:10px;display:flex;align-items:center;gap:9px}.agent-banner b{font-size:9px}.agent-banner p{margin:2px 0 0;color:var(--muted);font-size:8px}.spinner{width:14px;height:14px;border:2px solid #41545f;border-top-color:var(--red);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.issue-list{display:grid;gap:8px;max-height:485px;overflow:auto;padding-right:3px}.issue{border:1px solid var(--line);background:#13212b;position:relative}.issue.rule{border-left:3px solid var(--red)}.issue.contract,.issue.semantic{border-left:3px solid var(--amber)}.issue-top{padding:10px;display:flex;gap:9px;align-items:start;cursor:pointer}.tag{font:700 7px monospace;padding:4px 5px;background:#2b2025;color:#ff7a84}.contract .tag,.semantic .tag{background:#332d21;color:var(--amber)}.issue-title{flex:1}.issue-title b{font-size:10px;display:block}.issue-title small{font:8px monospace;color:var(--muted)}.issue-detail{border-top:1px solid var(--line);padding:10px;font-size:9px;line-height:1.6}.kv{display:grid;grid-template-columns:65px 1fr;gap:5px;margin-bottom:3px}.kv span:first-child{color:var(--muted)}.diff{display:grid;grid-template-columns:1fr 20px 1fr;align-items:center;margin:8px 0}.diff b{padding:8px;background:#261c23;color:#ff7a84;text-align:center;font:10px monospace}.diff b:last-child{background:#172d29;color:var(--green)}.diff i{text-align:center;color:var(--muted)}.decision{display:flex;gap:6px}.decision button{flex:1}.decision .accepted{border-color:var(--green);color:var(--green)}.decision .rejected{border-color:var(--red);color:#ff7a84}.empty{min-height:360px;display:grid;place-items:center;text-align:center;color:var(--muted)}.reticle{width:90px;height:90px;border:1px solid #38505d;transform:rotate(45deg);display:grid;place-items:center;margin:auto}.reticle:after{content:"+";font:28px monospace;color:var(--red);transform:rotate(-45deg)}.empty h3{color:var(--cream);font-size:13px;margin:20px 0 5px}.empty p{font-size:9px;line-height:1.6}.review-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.switch{display:flex;border:1px solid var(--line);margin-bottom:10px}.switch button{flex:1;background:#121f28;border:0;color:var(--muted);padding:8px;font-size:9px}.switch button.active{background:var(--cream);color:var(--bg);font-weight:800}.arena{border:1px solid #40535e;background:#111d26}.arena-view{height:260px;position:relative;overflow:hidden;background:radial-gradient(circle at 50% 35%,#2b4655,#142630 56%,#0d171e);perspective:500px}.arena-grid{position:absolute;inset:0;background:linear-gradient(90deg,transparent 49.7%,rgba(236,232,225,.1) 50%,transparent 50.3%),linear-gradient(transparent 49.7%,rgba(236,232,225,.1) 50%,transparent 50.3%);background-size:52px 52px;transform:rotateX(58deg) scale(1.8);transform-origin:bottom;opacity:.45}.range-lines{position:absolute;inset:25px;border:1px solid rgba(236,232,225,.14);clip-path:polygon(0 0,86% 0,100% 14%,100% 100%,14% 100%,0 86%)}.range-lines:before,.range-lines:after{content:"";position:absolute;background:rgba(236,232,225,.12)}.range-lines:before{width:1px;height:100%;left:50%}.range-lines:after{height:1px;width:100%;top:50%}.target{position:absolute;left:50%;top:43%;width:66px;height:66px;transform:translate(-50%,-50%);border:2px solid var(--red);border-radius:50%;box-shadow:0 0 0 12px rgba(255,70,85,.06),0 0 25px rgba(255,70,85,.18)}.target:before,.target:after{content:"";position:absolute;background:var(--red)}.target:before{width:90px;height:1px;left:-14px;top:31px}.target:after{height:90px;width:1px;left:31px;top:-14px}.hud{position:absolute;inset:12px;display:flex;justify-content:space-between;align-items:start}.hud-label{font:8px monospace;color:#9db0ba;letter-spacing:1px}.balance{background:#0a1218;border:1px solid #445863;padding:7px 10px;font:700 11px monospace}.balance em{color:var(--amber);font-style:normal}.mission{padding:13px;background:#172731}.mission-meta{display:flex;justify-content:space-between;color:var(--muted);font:8px monospace}.mission h3{font:800 18px/1 Impact,"Arial Narrow",sans-serif;letter-spacing:1px;margin:8px 0}.reward{display:flex;justify-content:space-between;padding:9px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:9px}.reward b{color:var(--amber)}.game-buttons{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.game-msg{min-height:30px;padding:8px 0 0;font-size:9px;color:#9aaab2}.preview-error{padding:9px;background:#2b1d23;border-left:2px solid var(--red);color:#ff929a;font-size:9px;margin-top:8px}.version{display:grid;grid-template-columns:1fr 1fr;margin-top:8px;border:1px solid var(--line)}.version div{padding:8px}.version div+div{border-left:1px solid var(--line)}.version small{display:block;color:var(--muted);font-size:7px}.version b{font:9px monospace}.log-panel{display:none;margin:0 24px 24px;border:1px solid var(--line);background:#111d26}.log-panel.active{display:block}.log-head{padding:12px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}.log-list{max-height:300px;overflow:auto}.log{display:grid;grid-template-columns:80px 150px 1fr 90px;gap:10px;padding:9px 12px;border-bottom:1px solid #263843;font:9px monospace}.log .ok{color:var(--green)}.log .fail{color:var(--red)}.unofficial{position:fixed;right:9px;bottom:7px;color:#60717a;font:7px monospace;letter-spacing:1px;writing-mode:vertical-rl}.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);background:var(--cream);color:var(--bg);padding:10px 16px;font-size:10px;font-weight:700;opacity:0;transition:.2s;z-index:30}.toast.show{opacity:1;transform:translate(-50%,0)}.hidden{display:none!important}@media(max-width:1150px){.grid{grid-template-columns:1fr 1fr}.right{grid-column:1/-1}.arena{display:grid;grid-template-columns:1.2fr 1fr}.arena-view{height:auto;min-height:280px}.nav{display:none}}@media(max-width:740px){.top{padding:0 14px;height:64px}.brand{min-width:0}.brand b{font-size:12px}.system .version-label{display:none}.hero{padding:20px 14px 14px;display:block}.hero h1{font-size:31px}.statebar{margin-top:14px}.grid{display:block;margin:0 8px 18px}.col{min-height:0}.arena{display:block}.arena-view{height:230px}.summary{grid-template-columns:repeat(2,1fr)}.log-panel{margin:0 8px 18px}.log{grid-template-columns:64px 110px 1fr}.log span:last-child{display:none}}
</style></head><body>
<header class="top"><div class="brand"><div class="mark">TC</div><div><b>TACTICAL CONFIG</b><small>战术配置台 / AGENT CONSOLE</small></div></div><nav class="nav"><button class="active" data-view="config">配置检查</button><button data-view="preview">游戏预览</button><button data-view="logs">执行记录</button></nav><div class="system"><span class="version-label">CONFIG <b id="topVersion">v1 · ORIGINAL</b></span><span class="status-dot" id="modelDot"></span><span>QWEN-PLUS <b id="modelState">检测中</b></span></div></header>
<section class="hero"><div><p>// CONFIGURATION ASSURANCE SYSTEM · BUILD 01</p><h1>CHECK. PATCH. <em>DEPLOY.</em></h1><p>需求、规则与运行结果在同一条证据链上。Agent 提议，确定性代码把关，你决定是否修改。</p></div><div class="statebar"><span>当前状态</span><b id="workflowState">未加载</b></div></section>
<main class="grid" id="workspace">
<section class="col left" data-code="INPUT_01"><div class="section-head"><span class="num">01</span><div><h2>需求与文件</h2><small>MISSION BRIEF & DATA</small></div></div>
<div class="box"><div class="box-head"><span>活动需求</span><span>REQUIREMENT</span></div><div class="box-body"><textarea class="req" id="requirement">完成一次训练，奖励100金币，每个账号限领一次。</textarea><div class="preset-row"><button class="btn" id="normalBtn">正常示例</button><button class="btn" id="badBtn">错误示例 · 金额</button><button class="btn" id="fullBadBtn">综合错误样例</button><button class="btn" id="vagueBtn">模糊需求样例</button></div></div></div>
<div class="box"><div class="box-head"><span>配置文件</span><span>CSV / UTF-8</span></div><div class="box-body"><label class="file-drop" for="files"><strong>＋ 上传三张配置表</strong>tasks.csv · rewards.csv · items.csv</label><input id="files" type="file" multiple accept=".csv,text/csv" hidden><div class="file-pills" id="filePills"></div></div><div class="tabs" id="tableTabs"></div><div class="table-wrap" id="tableView"></div></div>
<div class="box"><div class="box-head"><span>项目规则</span><span>RULESET / 6</span></div><div class="box-body"><ul class="rules"><li>各表主键不可重复</li><li>奖励与物品引用必须存在</li><li>数量与领取次数为正整数</li><li>单任务金币奖励 ≤ 500</li><li>仅支持“完成一次训练”</li><li>修改字段受服务端白名单约束</li></ul></div></div><button class="btn red main-action" id="checkBtn">开始检查 / RUN INSPECTION</button></section>
<section class="col center" data-code="REVIEW_02"><div class="section-head"><span class="num">02</span><div><h2>问题与修复</h2><small>ISSUES, EVIDENCE & PATCHES</small></div></div><div class="summary"><div class="metric block"><b id="blockCount">0</b><small>确定性错误</small></div><div class="metric warn"><b id="semanticCount">0</b><small>一致性问题</small></div><div class="metric"><b id="patchCount">0</b><small>待确认修改</small></div><div class="metric ok"><b id="resolvedCount">0</b><small>已解决</small></div></div><div class="agent-banner" id="agentBanner"><span class="status-dot" id="agentDot"></span><div><b id="agentTitle">AGENT 待命</b><p id="agentMessage">加载配置后运行检查</p></div></div><div class="empty" id="emptyReview"><div><div class="reticle"></div><h3>等待检查指令</h3><p>确定性规则与 AI 语义核对将分别显示。<br>所有候选修改均需人工确认。</p></div></div><div class="issue-list hidden" id="issueList"></div><div class="review-actions"><button class="btn red" id="applyBtn" disabled>应用已接受修改</button><button class="btn" id="recheckBtn" disabled>重新检查</button><button class="btn ghost" id="exportConfigBtn">导出配置</button><button class="btn ghost" id="exportReportBtn">导出报告</button></div></section>
<section class="col right" data-code="SIM_03"><div class="section-head"><span class="num">03</span><div><h2>玩家活动预览</h2><small>LIVE CONFIG EXECUTION</small></div></div><div class="switch"><button class="active" data-source="original">原始配置</button><button data-source="working">修复后配置</button></div><div class="arena"><div class="arena-view"><div class="arena-grid"></div><div class="range-lines"></div><div class="target"></div><div class="hud"><span class="hud-label">TRAINING_RANGE // 01<br>LIVE SIMULATION</span><span class="balance">◎ <em id="balance">0</em></span></div></div><div class="mission"><div class="mission-meta"><span>TACTICAL TRAINING</span><span id="missionStatus">INCOMPLETE</span></div><h3 id="missionTitle">完成一次训练</h3><div class="reward"><span>任务奖励</span><b>◎ <span id="rewardAmount">—</span> <span id="rewardName">金币</span></b><span id="claimLimit">0 / —</span></div><div class="game-buttons"><button class="btn" id="completeBtn">完成训练</button><button class="btn red" id="claimBtn" disabled>领取奖励</button></div><div class="game-msg" id="gameMsg">载入配置后可开始测试</div></div></div><div class="preview-error hidden" id="previewError"></div><div class="version"><div><small>LOADED SOURCE</small><b id="previewSource">ORIGINAL</b></div><div><small>CONFIG VERSION</small><b id="previewVersion">v1</b></div></div><button class="btn ghost main-action" id="resetBtn">↻ 重置预览状态</button></section>
</main>
<section class="log-panel" id="logPanel"><div class="log-head"><b>执行记录 / TOOL EXECUTION LOG</b><button class="btn" id="clearLogs">清空当前视图</button></div><div class="log-list" id="logList"></div></section><div class="unofficial">非官方交互原型 / UNOFFICIAL INTERACTIVE PROTOTYPE</div><div class="toast" id="toast"></div>
<script>
const NORMAL={tasks:[{task_id:'T001',title:'完成一次训练',reward_id:'R001',claim_limit:1}],rewards:[{reward_id:'R001',item_id:'GOLD',amount:100}],items:[{item_id:'GOLD',name:'金币'},{item_id:'TICKET',name:'训练券'}]};
const AMOUNT_BAD={tasks:[{task_id:'T001',title:'完成一次训练',reward_id:'R001',claim_limit:1}],rewards:[{reward_id:'R001',item_id:'GOLD',amount:10}],items:[{item_id:'GOLD',name:'金币'},{item_id:'TICKET',name:'训练券'}]};
const FULL_BAD={tasks:[{task_id:'T001',title:'完成一次训练',reward_id:'R001',claim_limit:1},{task_id:'T001',title:'完成一次训练',reward_id:'R404',claim_limit:1}],rewards:[{reward_id:'R001',item_id:'GOLD',amount:10},{reward_id:'R002',item_id:'TICKET',amount:-5}],items:[{item_id:'GOLD',name:'金币'},{item_id:'TICKET',name:'训练券'}]};
const CONTRACT={taskTitle:'完成一次训练',itemId:'GOLD',amount:100,claimLimit:1};
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
let original=null,working=null,version=0,checkedFingerprint='',issues=[],decisions={},resolved=[],logs=[],activeTable='tasks',source='original',game={completed:false,claims:0,balance:0},demoContract=null,demoClarification=false,workflow='未加载';
function copy(v){return JSON.parse(JSON.stringify(v))} function esc(v){return String(v==null?'—':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function setState(s){workflow=s;$('#workflowState').textContent=s;log('workflow_state',{state:s},'ok')}
function log(tool,input,result){logs.unshift({time:new Date().toLocaleTimeString('zh-CN',{hour12:false}),tool:tool,input:JSON.stringify(input).slice(0,90),result:result});renderLogs()}
function recordTrace(trace){(trace||[]).forEach(function(x){log(x.tool,x.input,typeof x.result==='string'?x.result:'ok')})}
function renderLogs(){$('#logList').innerHTML=logs.length?logs.map(function(x){return '<div class="log"><span>'+esc(x.time)+'</span><b>'+esc(x.tool)+'</b><span>'+esc(x.input)+'</span><span class="'+(x.result==='ok'?'ok':'fail')+'">'+esc(x.result)+'</span></div>'}).join(''):'<div class="log" style="display:block;color:var(--muted)">暂无执行记录</div>'}
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove('show')},2200)}
function loadSample(type){const data=type==='normal'?NORMAL:type==='full'?FULL_BAD:AMOUNT_BAD;original=copy(data);working=copy(data);version=1;demoContract=CONTRACT;demoClarification=false;issues=[];decisions={};resolved=[];$('#requirement').value='完成一次训练，奖励100金币，每个账号限领一次。';setState('可检查');log('load_example',{type:type,rows:{tasks:data.tasks.length,rewards:data.rewards.length,items:data.items.length}},'ok');renderAll();resetPreview();}
function renderAll(){renderFiles();renderTable();renderIssues();updatePreview();$('#topVersion').textContent='v'+version+' · '+(source==='original'?'ORIGINAL':'WORKING')}
function renderFiles(){$('#filePills').innerHTML=['tasks','rewards','items'].map(function(k){return '<span class="file-pill">'+k+'.csv · '+(working&&working[k]?working[k].length:0)+' ROWS</span>'}).join('');$('#tableTabs').innerHTML=['tasks','rewards','items'].map(function(k){return '<button data-table="'+k+'" class="'+(activeTable===k?'active':'')+'">'+k+'.csv</button>'}).join('');$$('[data-table]').forEach(function(b){b.onclick=function(){activeTable=b.dataset.table;renderAll()}})}
function renderTable(){if(!working||!working[activeTable]||!working[activeTable].length){$('#tableView').innerHTML='<div style="padding:12px;color:var(--muted);font-size:9px">未加载数据</div>';return}const rows=working[activeTable],keys=Object.keys(rows[0]);$('#tableView').innerHTML='<table class="data-table"><thead><tr>'+keys.map(function(k){return '<th>'+esc(k)+'</th>'}).join('')+'</tr></thead><tbody>'+rows.map(function(r){return '<tr>'+keys.map(function(k){return '<td>'+esc(r[k])+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table>'}
function renderIssues(){const rule=issues.filter(function(x){return x.kind==='rule'}),semantic=issues.filter(function(x){return x.kind!=='rule'}),pending=issues.filter(function(x){return x.suggestion&&decisions[x.id]!=='rejected'&&decisions[x.id]!=='accepted'});$('#blockCount').textContent=rule.length;$('#semanticCount').textContent=semantic.length;$('#patchCount').textContent=pending.length;$('#resolvedCount').textContent=resolved.length;$('#emptyReview').classList.toggle('hidden',issues.length>0);$('#issueList').classList.toggle('hidden',issues.length===0);$('#issueList').innerHTML=issues.map(issueHtml).join('');$('#applyBtn').disabled=!issues.some(function(x){return x.suggestion&&decisions[x.id]==='accepted'});$('#recheckBtn').disabled=!working;bindIssueActions()}
function issueHtml(x){const d=decisions[x.id]||'';const label=x.kind==='rule'?'RULE':x.kind==='contract'?'CONTRACT':'AI REVIEW';let patch='';if(x.suggestion){patch='<div class="diff"><b>'+esc(x.current)+'</b><i>→</i><b>'+esc(x.suggestion.value)+'</b></div><div class="decision"><button class="btn '+(d==='accepted'?'accepted':'')+'" data-accept="'+esc(x.id)+'">'+(d==='accepted'?'✓ 已接受':'接受修改')+'</button><button class="btn '+(d==='rejected'?'rejected':'')+'" data-reject="'+esc(x.id)+'">'+(d==='rejected'?'× 已拒绝':'拒绝修改')+'</button></div>'}return '<article class="issue '+esc(x.kind)+'"><div class="issue-top"><span class="tag">'+label+'</span><div class="issue-title"><b>'+esc(x.message)+'</b><small>'+esc(x.location.table)+'.csv / '+esc(x.location.id)+' / '+esc(x.location.field)+'</small></div></div><div class="issue-detail"><div class="kv"><span>当前值</span><b>'+esc(x.current)+'</b></div><div class="kv"><span>检查依据</span><span>'+esc(x.basis)+'</span></div><div class="kv"><span>处理状态</span><span>'+(x.suggestion?'可生成受控补丁':'仅报告，禁止无依据修复')+'</span></div>'+patch+'</div></article>'}
function bindIssueActions(){$$('[data-accept]').forEach(function(b){b.onclick=function(){decisions[b.dataset.accept]='accepted';log('review_patch',{issue_id:b.dataset.accept,decision:'accept'},'ok');renderIssues()}});$$('[data-reject]').forEach(function(b){b.onclick=function(){decisions[b.dataset.reject]='rejected';log('review_patch',{issue_id:b.dataset.reject,decision:'reject'},'ok');renderIssues()}})}
async function check(isRecheck){if(!working){toast('请先加载或上传配置');return}if(JSON.stringify(working)!==checkedFingerprint&&isRecheck===false) decisions={};setState(isRecheck?'复检中':'检查中');$('#agentTitle').textContent='AGENT 执行中';$('#agentMessage').textContent='read_config → validate_config → Qwen-Plus → propose_patch';$('#agentBanner').insertAdjacentHTML('afterbegin','<span class="spinner" id="busy"></span>');$('#checkBtn').disabled=true;try{const response=await fetch('/api/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requirement:$('#requirement').value,config:working,demoContract:demoContract,demoClarification:demoClarification})});const data=await response.json();if(!response.ok)throw new Error(data.error||'检查失败');issues=[].concat(data.ruleIssues||[],data.semanticIssues||[]);checkedFingerprint=JSON.stringify(working);recordTrace(data.toolTrace);if(data.clarification)log('qwen_plus',{status:'clarification',question:data.clarification.question},'needs_input');else log('qwen_plus',{model:'qwen-plus'},data.ai.state==='connected'?'ok':data.ai.state);$('#modelState').textContent=data.ai.state==='connected'?'已连接':data.ai.state==='unavailable'?'未配置':'待补充';$('#modelDot').classList.toggle('on',data.ai.state==='connected');$('#agentTitle').textContent=data.clarification?'需求信息不足':data.ai.state==='connected'?'Qwen-Plus 检查完成':'规则检查完成';$('#agentMessage').textContent=data.clarification?data.clarification.question:data.ai.message;if(data.clarification||data.ai.state==='needs_input'){setState('需要补充');toast(data.clarification?data.clarification.question:data.ai.message)}else if(issues.some(function(x){return x.suggestion})){setState('待确认修改')}else if(issues.length){setState(isRecheck?'复检失败':'发现阻断问题')}else{setState(isRecheck?'复检通过':'检查通过')}renderIssues()}catch(e){$('#agentTitle').textContent='检查失败';$('#agentMessage').textContent=e.message;setState('复检失败');log('validate_config',{error:e.message},'failed');toast(e.message)}finally{$('#busy')&&$('#busy').remove();$('#checkBtn').disabled=false}}
function validatePatchLocal(p){const allowed={rewards:['amount'],tasks:['claim_limit']};if(!allowed[p.table]||allowed[p.table].indexOf(p.field)<0)return{ok:false,reason:'字段不在白名单'};const key=p.table==='rewards'?'reward_id':'task_id',row=working[p.table].find(function(x){return String(x[key])===String(p.id)}),v=Number(p.value);if(!row)return{ok:false,reason:'记录不存在'};if(!Number.isInteger(v)||v<=0)return{ok:false,reason:'必须为正整数'};if(p.table==='rewards'&&row.item_id==='GOLD'&&v>500)return{ok:false,reason:'超过金币上限'};return{ok:true,row:row,value:v,before:row[p.field]}}
async function applyAccepted(){if(JSON.stringify(working)!==checkedFingerprint){setState('可检查');decisions={};toast('文件已变化，旧修复方案失效');log('propose_patch',{reason:'config_changed'},'expired');renderIssues();return}const accepted=issues.filter(function(x){return x.suggestion&&decisions[x.id]==='accepted'}).map(function(x){return x.suggestion});if(!accepted.length)return;try{const response=await fetch('/api/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:working,patches:accepted})});const data=await response.json();recordTrace(data.toolTrace);if(!response.ok)throw new Error(data.error||'应用修改失败');working=data.config;resolved.push.apply(resolved,data.diffs||[]);version++;decisions={};source='working';$$('[data-source]').forEach(function(b){b.classList.toggle('active',b.dataset.source==='working')});renderAll();resetPreview();toast('修改已应用到工作副本，开始复检');await check(true)}catch(e){toast(e.message);log('apply_patch',{error:e.message},'failed')}}
function activeConfig(){return source==='original'?original:working} function previewData(){const c=activeConfig();if(!c)return{error:'未加载配置'};const t=c.tasks&&c.tasks[0];if(!t)return{error:'任务表为空'};const r=c.rewards&&c.rewards.find(function(x){return String(x.reward_id)===String(t.reward_id)});if(!r)return{error:'奖励 '+t.reward_id+' 不存在，已阻止发奖'};const i=c.items&&c.items.find(function(x){return String(x.item_id)===String(r.item_id)});if(!i)return{error:'物品 '+r.item_id+' 不存在，已阻止发奖'};if(!Number.isInteger(Number(r.amount))||Number(r.amount)<=0)return{error:'奖励数量无效，已阻止发奖'};return{task:t,reward:r,item:i}}
function updatePreview(){const v=previewData();$('#previewSource').textContent=source.toUpperCase();$('#previewVersion').textContent='v'+(source==='original'?1:version);$('#topVersion').textContent='v'+(source==='original'?1:version)+' · '+source.toUpperCase();$('#balance').textContent=game.balance;$('#missionStatus').textContent=game.completed?'COMPLETE':'INCOMPLETE';$('#completeBtn').disabled=game.completed;if(v.error){$('#previewError').textContent=v.error;$('#previewError').classList.remove('hidden');$('#rewardAmount').textContent='—';$('#claimBtn').disabled=true;$('#gameMsg').textContent='配置不可执行';return}$('#previewError').classList.add('hidden');$('#missionTitle').textContent=v.task.title;$('#rewardAmount').textContent=v.reward.amount;$('#rewardName').textContent=v.item.name;$('#claimLimit').textContent=game.claims+' / '+v.task.claim_limit;$('#claimBtn').disabled=!game.completed||game.claims>=Number(v.task.claim_limit);$('#claimBtn').textContent=game.claims>=Number(v.task.claim_limit)?'已达领取上限':'领取奖励'}
function resetPreview(){game={completed:false,claims:0,balance:0};$('#gameMsg').textContent=working?'先完成训练，再领取配置中的实际奖励':'载入配置后可开始测试';updatePreview();log('preview_reset',{source:source},'ok')}
async function previewAction(action){const v=previewData();if(v.error){updatePreview();log('run_preview',{error:v.error},'blocked');return}try{const response=await fetch('/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:activeConfig(),state:game,taskId:v.task.task_id,action:action,source:source})});const data=await response.json();recordTrace(data.toolTrace);if(!response.ok)throw new Error(data.error||'预览执行失败');game=data.state;if(action==='complete')$('#gameMsg').textContent='训练完成，奖励已解锁';else $('#gameMsg').textContent='发奖成功：+'+data.reward.amount+' '+data.reward.item_name+'（沿 '+v.task.task_id+' → '+data.reward.reward_id+' → '+data.reward.item_id+'）';updatePreview()}catch(e){$('#gameMsg').textContent=e.message;log('run_preview',{task_id:v.task.task_id,action:action},'blocked');updatePreview()}}
function completeTraining(){previewAction('complete')}
function claim(){previewAction('claim')}
function splitCSV(line){let out=[],cur='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){out.push(cur);cur=''}else cur+=c}out.push(cur);return out}
function parseCSV(text){const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean);if(lines.length<2)throw new Error('CSV 至少需要表头和一行数据');const head=splitCSV(lines.shift()).map(function(x){return x.trim()});return lines.map(function(line){const vals=splitCSV(line);const row={};head.forEach(function(h,i){let val=(vals[i]||'').trim();if(['amount','claim_limit'].indexOf(h)>=0&&/^-?\d+$/.test(val))val=Number(val);row[h]=val});return row})}
async function upload(files){const next={};try{for(const f of files){const key=['tasks','rewards','items'].find(function(k){return f.name.toLowerCase()===k+'.csv'});if(!key)continue;next[key]=parseCSV(await f.text());log('parse_csv',{file:f.name,rows:next[key].length},'ok')}const missing=['tasks','rewards','items'].filter(function(k){return !next[k]});if(missing.length)throw new Error('缺少文件：'+missing.join(', '));original=copy(next);working=copy(next);version=1;demoContract=null;demoClarification=false;issues=[];resolved=[];decisions={};setState('可检查');renderAll();resetPreview()}catch(e){setState('未加载');log('parse_csv',{error:e.message},'failed');toast(e.message)}}
function download(name,data,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type:type||'application/json'}));a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},1000)}
function configZipLike(){return JSON.stringify({version:version,config:working,changes:resolved},null,2)}
async function detectModel(){try{const r=await fetch('/api/status'),d=await r.json();$('#modelState').textContent=d.modelConfigured?'已配置':'未配置';$('#modelDot').classList.toggle('on',d.modelConfigured);$('#agentMessage').textContent=d.modelConfigured?'Qwen-Plus 已配置，等待检查':'Qwen-Plus 未配置；确定性工具仍可用'}catch{$('#modelState').textContent='不可用'}}
$('#normalBtn').onclick=function(){loadSample('normal')};$('#badBtn').onclick=function(){loadSample('amount')};$('#fullBadBtn').onclick=function(){loadSample('full')};$('#vagueBtn').onclick=function(){loadSample('amount');$('#requirement').value='把奖励提高一点';demoContract=null;demoClarification=true;setState('可检查');toast('已加载模糊需求演示')};$('#files').onchange=function(e){upload(Array.from(e.target.files))};$('#checkBtn').onclick=function(){check(false)};$('#recheckBtn').onclick=function(){check(true)};$('#applyBtn').onclick=applyAccepted;$('#completeBtn').onclick=completeTraining;$('#claimBtn').onclick=claim;$('#resetBtn').onclick=resetPreview;$('#exportConfigBtn').onclick=function(){download('tactical-config-v'+version+'.json',configZipLike())};$('#exportReportBtn').onclick=function(){download('inspection-report.json',JSON.stringify({state:workflow,issues:issues,resolved:resolved,logs:logs},null,2))};$('#clearLogs').onclick=function(){logs=[];renderLogs()};$('#requirement').oninput=function(){demoClarification=false;if(checkedFingerprint){checkedFingerprint='stale';decisions={};setState('可检查');renderIssues()}};
$$('[data-source]').forEach(function(b){b.onclick=function(){source=b.dataset.source;$$('[data-source]').forEach(function(x){x.classList.toggle('active',x===b)});resetPreview()}});$$('.nav button').forEach(function(b){b.onclick=function(){$$('.nav button').forEach(function(x){x.classList.toggle('active',x===b)});if(b.dataset.view==='logs'){$('#logPanel').classList.add('active');$('#logPanel').scrollIntoView({behavior:'smooth'})}else{$('#logPanel').classList.remove('active');const target=b.dataset.view==='preview'?$('.right'):$('.left');target.scrollIntoView({behavior:'smooth'})}}});
renderLogs();renderAll();detectModel();
</script></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/status') return json({ modelConfigured:Boolean(env.DASHSCOPE_API_KEY), model:env.QWEN_MODEL || 'qwen-plus', provider:'Alibaba Cloud Model Studio' });
    if (url.pathname === '/api/check' && request.method === 'POST') return checkRequest(request, env);
    if (url.pathname === '/api/apply' && request.method === 'POST') return applyRequest(request);
    if (url.pathname === '/api/preview' && request.method === 'POST') return previewRequest(request);
    if (url.pathname === '/' && request.method === 'GET') return new Response(page,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
    return new Response('Not found',{status:404});
  }
};
