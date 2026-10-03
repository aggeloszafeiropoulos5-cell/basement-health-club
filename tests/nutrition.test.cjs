const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const vm=require('node:vm');
const {PGlite}=require('@electric-sql/pglite');
const context={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/nutrition.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const {newNutrition,mealTotals,nutritionError}=context.exports;
const owner='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',member='00000000-0000-4000-8000-000000000004';
test('manual totals and publication validation',()=>{const c=newNutrition();c.days[0][0].kcal='250';c.days[0][1].protein='20.5';assert.equal(mealTotals(c.days[0])[0],250);assert.equal(mealTotals(c.days[0])[1],20.5);assert.match(nutritionError('Πλάνο','2026-10-03','',c,true),/τρόφιμα/);c.days[0][0].food='Δοκιμή';assert.equal(nutritionError('Πλάνο','2026-10-03','',c,true),'');c.days[0][0].fat='-1';assert.match(nutritionError('Πλάνο','2026-10-03','',c,true),/αρνητικοί/);assert.equal(c.days[1][0].food,'');});
test('database ownership, published-only visibility, validation, revision conflict and archive',async()=>{
 const db=new PGlite();await db.exec(`create role authenticated;create role anon;create schema auth;create schema basement_private;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create table profiles(id uuid primary key,active boolean,role text);create table members(id uuid primary key,auth_user_id uuid);grant select on profiles,members to authenticated;insert into profiles values ('${owner}',true,'owner'),('${user}',true,'customer'),('${other}',true,'customer');insert into members values ('${member}','${user}');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261003093639_nutrition_plans.sql','utf8'));
 async function as(id,role='authenticated'){await db.exec(`reset role;set role ${role};select set_config('request.jwt.claim.sub','${id}',false);`)}
 await as(owner);const content=newNutrition();content.days[0][0].food='Test';
 const plan=(await db.query("insert into nutrition_plans(member_id,title,starts_on,content) values ($1,'Test','2026-10-03',$2) returning *",[member,JSON.stringify(content)])).rows[0];assert.equal(plan.revision,1);
 await as(user);assert.equal((await db.query('select * from nutrition_plans')).rows.length,0);
 await as(owner);await db.query("update nutrition_plans set status='published' where id=$1",[plan.id]);
 await as(user);assert.equal((await db.query('select * from nutrition_plans')).rows.length,1);assert.equal((await db.query("update nutrition_plans set title='Hack' where id=$1 returning id",[plan.id])).rows.length,0);await assert.rejects(db.query("insert into nutrition_plans(member_id,title,starts_on,content) values ($1,'Hack','2026-10-03',$2)",[member,JSON.stringify(content)]));
 await as(other);assert.equal((await db.query('select * from nutrition_plans')).rows.length,0);
 await as('', 'anon');await assert.rejects(db.query('select * from nutrition_plans'));
 await as(owner);assert.equal((await db.query("update nutrition_plans set title='Race' where id=$1 and revision=1 returning id",[plan.id])).rows.length,0);assert.equal((await db.query("update nutrition_plans set title='Updated' where id=$1 and revision=2 returning revision",[plan.id])).rows[0].revision,3);
 content.days[0][0].kcal='NaN';await assert.rejects(db.query('update nutrition_plans set content=$1 where id=$2',[JSON.stringify(content),plan.id]));content.days[0][0].kcal='';content.days.pop();await assert.rejects(db.query('update nutrition_plans set content=$1 where id=$2',[JSON.stringify(content),plan.id]));
 await db.query("update nutrition_plans set status='archived' where id=$1",[plan.id]);await as(user);assert.equal((await db.query('select * from nutrition_plans')).rows.length,0);await as(owner);assert.equal((await db.query('select * from nutrition_plans')).rows.length,1);await assert.rejects(db.query('delete from nutrition_plans'));await db.close();
});
