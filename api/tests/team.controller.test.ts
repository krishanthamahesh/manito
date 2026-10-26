import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthUser } from '../src/auth.service';
import { DatabaseService } from '../src/database.service';
import { TeamController } from '../src/team.controller';
import { PoolClient } from 'pg';

const admin:AuthUser={
  id:'admin-1',
  tenantId:'tenant-1',
  email:'admin@example.test',
  fullName:'Shop Admin',
  role:'admin',
  roleId:'admin-role',
  roleName:'Administrator',
  systemRole:'admin',
  permissions:['team.manage']
};

test('admin can edit employee profile details and email is normalized',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.includes('SELECT u.id,u.role_id'))return {rows:[{id:'employee-1',role_id:'employee-role',system_role:null,active:true}] as T[],rowCount:1};
      if(sql.startsWith('SELECT name FROM roles'))return {rows:[{name:'Employee'}] as T[],rowCount:1};
      if(sql.startsWith('UPDATE users'))return {rows:[{id:'employee-1',fullName:'Updated Employee',email:'updated@example.test',roleId:'employee-role',active:true,createdAt:'2026-01-01T00:00:00Z'}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;

  const result=await new TeamController(db).update({user:admin} as never,'employee-1',{fullName:' Updated Employee ',email:' Updated@Example.Test '});

  const update=calls.find(call=>call.sql.startsWith('UPDATE users'));
  assert.ok(update);
  assert.deepEqual(update.values,['employee-1','tenant-1','Updated Employee','updated@example.test',true,'employee','employee-role']);
  assert.equal(result.role,'Employee');
});

test('employee profile edit requires team-management permission',async()=>{
  const db={transaction:async()=>{throw new Error('Database must not be queried');}} as unknown as DatabaseService;
  await assert.rejects(
    ()=>new TeamController(db).update({user:{...admin,permissions:[],systemRole:null}} as never,'employee-1',{fullName:'Updated'}),
    /team\.manage permission is required/
  );
});

test('duplicate employee email returns a conflict error',async()=>{
  const client={
    query:async<T>(sql:string):Promise<{rows:T[];rowCount:number}>=>{
      if(sql.includes('SELECT u.id,u.role_id'))return {rows:[{id:'employee-1',role_id:'employee-role',system_role:null,active:true}] as T[],rowCount:1};
      if(sql.startsWith('SELECT name FROM roles'))return {rows:[{name:'Employee'}] as T[],rowCount:1};
      if(sql.startsWith('UPDATE users'))throw Object.assign(new Error('duplicate email'),{code:'23505'});
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;

  await assert.rejects(
    ()=>new TeamController(db).update({user:admin} as never,'employee-1',{email:'taken@example.test'}),
    failure=>failure instanceof ConflictException&&failure.message.includes('already exists')
  );
});

test('employee can update own name and normalized email without changing their role',async()=>{
  let updateValues:unknown[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/UPDATE users SET full_name=COALESCE/);
      updateValues=values;
      return {rows:[{id:'employee-1',fullName:'Alex Employee',email:'alex@example.test'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const employee={...admin,id:'employee-1',permissions:[],systemRole:null};
  const result=await new TeamController(db).updateOwnProfile({user:employee} as never,{fullName:' Alex Employee ',email:' ALEX@Example.Test '});
  assert.deepEqual(updateValues,['employee-1','tenant-1','Alex Employee','alex@example.test']);
  assert.deepEqual(result,{id:'employee-1',fullName:'Alex Employee',email:'alex@example.test'});
});

test('employee can only change their password after verifying the current password',async()=>{
  const currentPassword='current password value';
  const previousHash=await bcrypt.hash(currentPassword,4);
  const queries:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      queries.push({sql,values});
      if(sql.startsWith('SELECT password_hash'))return {rows:[{password_hash:previousHash}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const controller=new TeamController(db);
  const employee={...admin,id:'employee-1',permissions:[],systemRole:null};

  await assert.rejects(
    ()=>controller.changeOwnPassword({user:employee} as never,{currentPassword:'wrong password',newPassword:'new secure password'}),
    failure=>failure instanceof BadRequestException&&failure.message.includes('Current password is incorrect')
  );
  assert.equal(queries.some(query=>query.sql.startsWith('UPDATE users')),false);

  queries.length=0;
  assert.deepEqual(
    await controller.changeOwnPassword({user:employee} as never,{currentPassword,newPassword:'new secure password'}),
    {success:true}
  );
  const update=queries.find(query=>query.sql.startsWith('UPDATE users'));
  assert.ok(update);
  assert.deepEqual(update.values.slice(0,2),['employee-1','tenant-1']);
  assert.notEqual(update.values[2],'new secure password');
  assert.equal(await bcrypt.compare('new secure password',String(update.values[2])),true);
});

test('administrator can set a temporary password only for a tenant employee',async()=>{
  let updateValues:unknown[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/UPDATE users SET password_hash/);
      updateValues=values;
      return {rows:[{id:'employee-1'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  assert.deepEqual(
    await new TeamController(db).resetPassword({user:admin} as never,'employee-1',{password:'temporary password'}),
    {success:true}
  );
  assert.deepEqual(updateValues.slice(0,2),['employee-1','tenant-1']);
  assert.notEqual(updateValues[2],'temporary password');
  assert.equal(await bcrypt.compare('temporary password',String(updateValues[2])),true);
});

test('administrator password reset cannot bypass self-service password verification',async()=>{
  const db={query:async()=>{throw new Error('Database must not be queried');}} as unknown as DatabaseService;
  await assert.rejects(
    ()=>new TeamController(db).resetPassword({user:admin} as never,admin.id,{password:'temporary password'}),
    failure=>failure instanceof BadRequestException&&failure.message.includes('change-password form')
  );
});

test('temporary password reset requires team-management permission and scopes the employee to the tenant',async()=>{
  const db={query:async()=>{throw new Error('Database must not be queried');}} as unknown as DatabaseService;
  const controller=new TeamController(db);
  await assert.rejects(
    ()=>controller.resetPassword({user:{...admin,permissions:[],systemRole:null}} as never,'employee-1',{password:'temporary password'}),
    /team\.manage permission is required/
  );

  const scopedDb={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/WHERE id=\$1 AND tenant_id=\$2/);
      assert.deepEqual(values.slice(0,2),['employee-1','tenant-1']);
      return {rows:[] as T[],rowCount:0};
    }
  } as unknown as DatabaseService;
  await assert.rejects(
    ()=>new TeamController(scopedDb).resetPassword({user:admin} as never,'employee-1',{password:'temporary password'}),
    /Employee account was not found/
  );
});

test('employee profile photo reads return a tenant-scoped data URL',async()=>{
  let values:unknown[]=[];
  const db={
    query:async<T>(_sql:string,parameters:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      values=parameters;
      return {rows:[{profile_picture_base64:'iVBORw0KGgo=',profile_picture_content_type:'image/png'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const result=await new TeamController(db).getOwnPhoto({user:{...admin,id:'employee-1'}} as never);
  assert.deepEqual(values,['employee-1','tenant-1']);
  assert.deepEqual(result,{photoDataUrl:'data:image/png;base64,iVBORw0KGgo='});
});

test('employee can upload only a verified supported image as their own profile photo',async()=>{
  let updateValues:unknown[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/UPDATE users SET profile_picture/);
      updateValues=values;
      return {rows:[{id:'employee-1'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const controller=new TeamController(db);
  const employee={...admin,id:'employee-1'};
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01]);
  assert.deepEqual(
    await controller.saveOwnPhoto({user:employee} as never,{buffer:png,mimetype:'image/png'}),
    {success:true}
  );
  assert.deepEqual(updateValues.slice(0,2),['employee-1','tenant-1']);
  assert.equal(updateValues[2],png);
  assert.equal(updateValues[3],'image/png');
  await assert.rejects(
    ()=>controller.saveOwnPhoto({user:employee} as never,{buffer:Buffer.from('not an image'),mimetype:'image/png'}),
    failure=>failure instanceof BadRequestException&&failure.message.includes('genuine')
  );
});

test('employee can remove only their own profile picture in their tenant',async()=>{
  let values:unknown[]=[];
  const db={
    query:async<T>(sql:string,parameters:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/profile_picture=NULL/);
      values=parameters;
      return {rows:[{id:'employee-1'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  assert.deepEqual(await new TeamController(db).deleteOwnPhoto({user:{...admin,id:'employee-1'}} as never),{success:true});
  assert.deepEqual(values,['employee-1','tenant-1']);
});
