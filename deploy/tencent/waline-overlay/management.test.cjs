'use strict';
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
process.env.NODE_PATH = path.join(__dirname, '../password-reset/node_modules');
require('node:module').Module._initPaths();
const { read } = require('./src/lib/management-read.js');
test('overlay uses fresh field arrays and admin-only read logic', async () => {
  const calls=[];
  const model={count:async where=>{calls.push(where);return 1;},select:async(where,options)=>{assert.equal(options.field.filter(key=>key==='id').length,0);options.field.push('id');return [{objectId:1,comment:'原文',nick:'昵称',url:'/a/',status:'approved',type:'guest',password:'secret','2fa':'SECRET',auth_version:0}];}};
  for(let i=0;i<2;i++){const result=await read(()=>model,{resource:'comment',id:1});assert.equal(result.deleteCount,1);assert.deepEqual(calls.at(-1),{_complex:{_logic:'or',objectId:1,pid:1,rid:1}});}
  const result=await read(()=>model,{resource:'user',id:1});assert.equal('password' in result,false);assert.equal('2fa' in result,false);
  global.think={isString:value=>typeof value==='string',isNumber:value=>typeof value==='number',Logic:class{constructor(ctx){this.ctx=ctx;} getModel(){return model;}get(){return {};}getResource(){return 'management';}getId(){return '';}}};
  const Logic=require('./src/logic/management.js');
  const denied=[];const ctx={state:{userInfo:{}},throw:status=>denied.push(status),path:'/api/management'};const logic=new Logic(ctx);logic.getAction();ctx.state.userInfo={objectId:8,type:'guest'};logic.getAction();ctx.state.userInfo={objectId:7,type:'administrator'};logic.getAction();logic.postAction();assert.deepEqual(denied,[401,403,405]);
});
test('security version trigger increments on password/email/type/2fa; ban/unban cannot revive old version',async()=>{
  const { PGlite }=await import('@electric-sql/pglite');const db=new PGlite();
  try{
    await db.exec(`CREATE TABLE wl_users(id integer primary key,password text,email text,type text,"2fa" text,auth_version integer not null default 0);INSERT INTO wl_users VALUES(7,'old','test@example.invalid','guest','',0);`);
    await db.exec(await readFile(path.join(__dirname,'../password-reset/001_password_reset.sql'),'utf8'));
    await db.exec(await readFile(path.join(__dirname,'003_security_version.sql'),'utf8'));
    for(const [column,value] of [['password','new'],['email','changed@example.invalid'],['type','banned'],['type','guest'],['"2fa"','enabled']])await db.query(`UPDATE wl_users SET ${column}=$1 WHERE id=7`,[value]);
    assert.equal((await db.query('SELECT auth_version FROM wl_users')).rows[0].auth_version,5);
    await db.exec('UPDATE wl_users SET type=type');assert.equal((await db.query('SELECT auth_version FROM wl_users')).rows[0].auth_version,5);
  }finally{await db.close();}
});
test('PostgreSQL state update keeps target role and version in the actual update condition', async()=>{
  const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
  try {
    await db.exec("CREATE TABLE wl_users(id integer primary key,type text,auth_version integer);INSERT INTO wl_users VALUES(8,'guest',0);");
    const moduleValue={exports:{}};
    const source=await readFile(path.join(__dirname,'src/service/storage/postgresql.js'),'utf8');
    new Function('require','module',source)(name=>name==='./mysql.js'?class {}:{toSqlOrder(){}},moduleValue);
    const storage=new moduleValue.exports();
    storage.model=()=>({where(condition){return {update:async data=>{const result=await db.query('UPDATE wl_users SET type=$1,auth_version=$2 WHERE id=$3 AND type=$4 AND auth_version=$5',[data.type,data.auth_version,condition.id,condition.type,condition.auth_version]);return result.affectedRows;}};}});
    assert.equal(await storage.managementState(8,'guest',0,'banned'),true);
    assert.equal(await storage.managementState(8,'banned',1,'guest'),true);
    assert.equal((await db.query('SELECT auth_version FROM wl_users')).rows[0].auth_version,2);
    await db.exec("UPDATE wl_users SET type='administrator'");
    assert.equal(await storage.managementState(8,'guest',2,'banned'),false);
    assert.equal((await db.query('SELECT type FROM wl_users')).rows[0].type,'administrator');
    assert.equal(await storage.managementState(8,'administrator',2,'guest'),false);
  }finally{await db.close();}
});
