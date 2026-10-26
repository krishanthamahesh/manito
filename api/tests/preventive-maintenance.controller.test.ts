import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { PreventiveMaintenanceController } from '../src/preventive-maintenance.controller';
import { AuthUser } from '../src/auth.service';
import { DatabaseService } from '../src/database.service';
import { PoolClient } from 'pg';

const user:AuthUser={
  id:'employee-1',
  tenantId:'tenant-1',
  email:'employee@example.test',
  fullName:'Test Employee',
  role:'employee',
  roleId:'role-1',
  roleName:'Employee',
  systemRole:null,
  permissions:['maintenance.read','maintenance.write']
};

test('maintenance plan creation stores the configured completion limit',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT id FROM assets'))return {rows:[{id:'asset-1'}] as T[],rowCount:1};
      if(sql.startsWith('INSERT INTO preventive_maintenance_plans'))return {rows:[{id:'plan-1',maxCompletedRuns:4}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;

  const result=await new PreventiveMaintenanceController(db).create({user} as never,{
    assetId:'asset-1',title:'Annual inspection',description:'Inspect and service the equipment.',
    intervalDays:365,maxCompletedRuns:4,nextDueDate:'2026-10-24'
  });

  assert.equal(result.maxCompletedRuns,4);
  const insert=calls.find(call=>call.sql.startsWith('INSERT INTO preventive_maintenance_plans'));
  assert.ok(insert);
  assert.match(insert.sql,/max_completed_runs/);
  assert.deepEqual(insert.values,['tenant-1','asset-1','employee-1','Annual inspection','Inspect and service the equipment.',365,4,'2026-10-24']);
});

test('expired maintenance plans cannot generate another work order',async()=>{
  let insertedJob=false;
  const client={
    query:async<T>(sql:string):Promise<{rows:T[];rowCount:number}>=>{
      if(sql.startsWith('SELECT p.asset_id'))return {rows:[{
        asset_id:'asset-1',title:'Annual inspection',description:'Inspect and service the equipment.',
        interval_days:365,max_completed_runs:4,completed_count:4,next_due_date:'2026-10-24',active:true,due:true
      }] as T[],rowCount:1};
      if(sql.startsWith('INSERT INTO jobs'))insertedJob=true;
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;

  await assert.rejects(
    ()=>new PreventiveMaintenanceController(db).generateWorkOrder({user} as never,'plan-1'),
    (failure:unknown)=>failure instanceof BadRequestException&&failure.message.includes('completed-work-order limit')
  );
  assert.equal(insertedJob,false);
});

test('expired maintenance plans cannot be reactivated',async()=>{
  const client={
    query:async<T>(sql:string):Promise<{rows:T[];rowCount:number}>=>{
      if(sql.startsWith('SELECT p.asset_id'))return {rows:[{max_completed_runs:4,completed_count:4}] as T[],rowCount:1};
      if(sql.startsWith('SELECT count(*)::int AS count'))return {rows:[{count:4}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  let updated=false;
  const transactionClient={
    query:async<T>(sql:string):Promise<{rows:T[];rowCount:number}>=>{
      if(sql.startsWith('UPDATE preventive_maintenance_plans'))updated=true;
      return client.query<T>(sql);
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(transactionClient as unknown as PoolClient)
  } as unknown as DatabaseService;

  await assert.rejects(
    ()=>new PreventiveMaintenanceController(db).update({user} as never,'plan-1',{active:true}),
    (failure:unknown)=>failure instanceof BadRequestException&&failure.message.includes('completed-work-order limit')
  );
  assert.equal(updated,false);
});

test('maintenance plan edits update the schedule and completion limit',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT p.asset_id'))return {rows:[{
        asset_id:'asset-1',title:'Old inspection',description:'Old instructions.',interval_days:90,
        max_completed_runs:4,next_due_date:'2026-10-24',active:true,completed_count:1
      }] as T[],rowCount:1};
      if(sql.startsWith('UPDATE preventive_maintenance_plans'))return {rows:[{
        id:'plan-1',active:true,assetId:'asset-2',title:'Updated inspection',
        description:'Updated instructions.',intervalDays:120,maxCompletedRuns:5,nextDueDate:'2026-11-01'
      }] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;

  const result=await new PreventiveMaintenanceController(db).update({user} as never,'plan-1',{
    assetId:'asset-2',title:'Updated inspection',description:'Updated instructions.',
    intervalDays:120,maxCompletedRuns:5,nextDueDate:'2026-11-01'
  });

  assert.equal(result.title,'Updated inspection');
  const update=calls.find(call=>call.sql.startsWith('UPDATE preventive_maintenance_plans'));
  assert.ok(update);
  assert.deepEqual(update.values,['plan-1','tenant-1',true,'asset-2','Updated inspection','Updated instructions.',120,5,'2026-11-01']);
});
