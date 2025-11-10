process.env.DB_HOST='127.0.0.1';
process.env.DB_USER='test';
process.env.DB_PASS='test';
process.env.DB_NAME='test';
process.env.JWT_SECRET='secret';
const { pool } = await import('./backend/src/lib/db.js');
const est = { plan: 'starter', plan_status: 'trialing', plan_trial_ends_at: null, plan_active_until: null, plan_subscription_id: null, plan_cycle: 'mensal' };
function normalize(sql){ return sql.replace(/\s+/g,' ').trim(); }
pool.query = async (sql, params=[])=>{
  const s = normalize(sql);
  if(s.startsWith("SELECT plan, plan_status, plan_trial_ends_at, plan_active_until, plan_subscription_id, plan_cycle FROM usuarios WHERE id=?")){
    return [[{...est}]];
  }
  if(s.startsWith("UPDATE usuarios SET")){
    const assigns = s.substring("UPDATE usuarios SET ".length, s.indexOf(' WHERE')).split(', ');
    assigns.forEach((a, i)=>{
      const col=a.split('=')[0];
      const val=params[i];
      if(col==='plan') est.plan = val;
      if(col==='plan_status') est.plan_status = val;
      if(col==='plan_trial_ends_at') est.plan_trial_ends_at = val;
      if(col==='plan_active_until') est.plan_active_until = val;
      if(col==='plan_subscription_id') est.plan_subscription_id = val;
      if(col==='plan_cycle') est.plan_cycle = val || 'mensal';
    });
    return [{affectedRows:1}];
  }
  return [[],[]];
};
const establishmentsRouter = (await import('./backend/src/routes/estabelecimentos.js')).default;
function getRouteHandler(router, path, method){
  const layer = router.stack.find((entry)=> entry.route && entry.route.path===path && entry.route.methods[method]);
  const stack = layer.route.stack; return stack[stack.length-1].handle;
}
const planHandler = getRouteHandler(establishmentsRouter, '/:id/plan', 'put');
function call(handler, req){ return new Promise((resolve)=>{ let status=200; const res={status:(c)=>{status=c;return res;}, json:(b)=>{resolve({status, body:b});}}; handler(req,res,()=>resolve({status,body:null})); }); }
const activeUntil = new Date(Date.now()+30*24*60*60*1000).toISOString();
const resp = await call(planHandler,{ params:{id:'1'}, user:{id:1,tipo:'estabelecimento', plan:'starter', plan_status:'trialing'}, body:{plan:'premium', status:'active', activeUntil } });
console.log(JSON.stringify(resp,null,2));
