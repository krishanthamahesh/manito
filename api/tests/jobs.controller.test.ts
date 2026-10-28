import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { JobsController } from '../src/jobs.controller';
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
  permissions:['jobs.read','jobs.update']
};
const creator:AuthUser={...user,permissions:['jobs.create']};

function assignmentHarness(contractorExists:boolean){
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT status,status_reason'))return {rows:[{status:'accepted',status_reason:null,priority:'normal',assigned_to:null,contractor_id:null,preferred_date:null,scheduled_date:null,completion_notes:null,title:'Pump repair',job_number:17,created_by:'creator'}] as T[],rowCount:1};
      if(sql.includes('FROM contractors WHERE id='))return {rows:(contractorExists?[{id:'contractor-1'}]:[]) as T[],rowCount:contractorExists?1:0};
      if(sql.startsWith('UPDATE jobs SET'))return {rows:[{id:'job-1',jobNumber:17,status:'accepted',statusReason:null,priority:'normal',assignedTo:null,contractorId:'contractor-1',preferredDate:null,scheduledDate:null,completionNotes:null,updatedAt:'2026-10-23T00:00:00.000Z'}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;
  return {controller:new JobsController(db),calls};
}

test('contractor assignment validates tenant ownership and clears the employee assignment', async()=>{
  const {controller,calls}=assignmentHarness(true);
  await controller.update({user} as never,'job-1',{contractorId:'contractor-1'});

  const validation=calls.find(call=>call.sql.includes('FROM contractors WHERE id='));
  const update=calls.find(call=>call.sql.startsWith('UPDATE jobs SET'));
  assert.ok(validation);
  assert.deepEqual(validation.values,['contractor-1','tenant-1']);
  assert.ok(update);
  assert.match(update.sql,/assigned_to=CASE WHEN \$5 THEN \$6 ELSE assigned_to END/);
  assert.equal(update.values[5],null);
  assert.equal(update.values[6],'contractor-1');
});

test('inactive or cross-tenant contractor assignment is rejected before update', async()=>{
  const {controller,calls}=assignmentHarness(false);
  await assert.rejects(
    ()=>controller.update({user} as never,'job-1',{contractorId:'contractor-1'}),
    (failure:unknown)=>failure instanceof BadRequestException&&failure.message.includes('active contractor')
  );
  assert.equal(calls.some(call=>call.sql.startsWith('UPDATE jobs SET')),false);
});

test('a work order cannot be assigned to both an employee and contractor', async()=>{
  const {controller,calls}=assignmentHarness(true);
  await assert.rejects(
    ()=>controller.update({user} as never,'job-1',{assignedTo:'employee-2',contractorId:'contractor-1'}),
    (failure:unknown)=>failure instanceof BadRequestException&&failure.message.includes('either an employee or a contractor')
  );
  assert.equal(calls.length,1);
  assert.match(calls[0].sql,/SELECT status,status_reason/);
});

test('completing a preventive work order expires its plan at the configured completed-run limit',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT status,status_reason'))return {rows:[{status:'in_progress',status_reason:null,priority:'normal',assigned_to:null,contractor_id:null,preferred_date:null,scheduled_date:null,completion_notes:null,title:'Preventive service',job_number:18,created_by:'creator'}] as T[],rowCount:1};
      if(sql.startsWith('UPDATE jobs SET'))return {rows:[{id:'job-pm',jobNumber:18,status:'completed',statusReason:null,priority:'normal',assignedTo:null,contractorId:null,preferredDate:null,scheduledDate:null,completionNotes:'Service complete',updatedAt:'2026-10-24T00:00:00.000Z'}] as T[],rowCount:1};
      if(sql.includes('FROM preventive_maintenance_runs r')&&sql.includes('FOR UPDATE OF p'))return {rows:[{id:'plan-1',max_completed_runs:4}] as T[],rowCount:1};
      if(sql.startsWith('SELECT count(*)::int AS count'))return {rows:[{count:4}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;
  await new JobsController(db).update({user} as never,'job-pm',{status:'completed',completionNotes:'Service complete'});

  const completeRun=calls.find(call=>call.sql.startsWith('UPDATE preventive_maintenance_runs'));
  const expirePlan=calls.find(call=>call.sql.startsWith('UPDATE preventive_maintenance_plans'));
  assert.ok(completeRun);
  assert.deepEqual(completeRun.values,['job-pm','tenant-1']);
  assert.ok(expirePlan);
  assert.deepEqual(expirePlan.values,['plan-1','tenant-1']);
});

test('job list search and pagination are scoped to the caller tenant', async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      return {rows:(sql.includes('count(*)')?[{total:'4'}]:[{id:'job-1',jobNumber:1}]) as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const result=await new JobsController(db).list({user} as never,'accepted','pump','1','10');

  assert.equal(result.total,4);
  assert.deepEqual(calls[0].values,['tenant-1','accepted','%pump%']);
  assert.deepEqual(calls[1].values,['tenant-1','accepted','%pump%',10,0]);
  assert.match(calls[1].sql,/LIMIT \$4 OFFSET \$5/);
});

test('job list can filter open jobs by the urgent summary metric',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      return {rows:(sql.includes('count(*)')?[{total:'2'}]:[{id:'job-1'},{id:'job-2'}]) as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const result=await new JobsController(db).list({user} as never,'open',undefined,'1','10','urgent');

  assert.equal(result.total,2);
  assert.deepEqual(calls[0].values,['tenant-1','urgent']);
  assert.match(calls[0].sql,/j\.status NOT IN \('completed','cancelled'\)/);
  assert.match(calls[0].sql,/\(j\.priority=\$2 OR j\.reported_urgency=\$2\)/);
  assert.deepEqual(calls[1].values,['tenant-1','urgent',10,0]);
});

test('job creation validates the customer tenant and stores an initial history event', async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT phone_intake_enabled'))return {rows:[{phone_intake_enabled:true,walk_in_intake_enabled:true}] as T[],rowCount:1};
      if(sql.startsWith('SELECT id FROM customers'))return {rows:[{id:'customer-1'}] as T[],rowCount:1};
      if(sql.startsWith('INSERT INTO jobs'))return {rows:[{id:'job-1',jobNumber:42,title:'Pump repair',status:'new'}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const result=await new JobsController(db).create({user:creator} as never,{
    customerId:'customer-1',
    title:' Pump repair ',
    description:' Pump is leaking ',
    contactChannel:'phone',
    location:' Shop ',
    reportedUrgency:'normal'
  });

  assert.deepEqual(result,{id:'job-1',jobNumber:42,title:'Pump repair',status:'new'});
  assert.deepEqual(calls[1].values,['customer-1','tenant-1']);
  assert.deepEqual(calls[2].values,['tenant-1','customer-1',null,null,'employee-1','Pump repair','Pump is leaking','phone',null,'Shop','normal',null]);
  assert.match(calls[3].sql,/INSERT INTO job_events/);
  assert.deepEqual(calls[3].values,['tenant-1','job-1','employee-1']);
});

test('job creation rejects a customer outside the caller tenant before inserting', async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT phone_intake_enabled'))return {rows:[{phone_intake_enabled:true,walk_in_intake_enabled:true}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:0};
    }
  } as unknown as DatabaseService;
  await assert.rejects(()=>new JobsController(db).create({user:creator} as never,{
    customerId:'other-tenant-customer',
    title:'Pump repair',
    description:'Pump is leaking',
    contactChannel:'phone',
    location:'Shop',
    reportedUrgency:'normal'
  }),/Select a customer from your organization/);
  assert.equal(calls.some(call=>call.sql.startsWith('INSERT INTO jobs')),false);
  assert.deepEqual(calls[1].values,['other-tenant-customer','tenant-1']);
});

test('job creation requires the selected intake channel to be enabled', async()=>{
  let customerQueried=false;
  const db={
    query:async<T>(sql:string):Promise<{rows:T[];rowCount:number}>=>{
      if(sql.startsWith('SELECT phone_intake_enabled'))return {rows:[{phone_intake_enabled:false,walk_in_intake_enabled:true}] as T[],rowCount:1};
      customerQueried=true;
      return {rows:[] as T[],rowCount:0};
    }
  } as unknown as DatabaseService;
  await assert.rejects(()=>new JobsController(db).create({user:creator} as never,{
    customerId:'customer-1',
    title:'Pump repair',
    description:'Pump is leaking',
    contactChannel:'phone',
    location:'Shop',
    reportedUrgency:'normal'
  }),/intake channel is disabled/);
  assert.equal(customerQueried,false);
});

test('completion requires completion details and records the completed status transition', async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT status,status_reason'))return {rows:[{status:'in_progress',status_reason:null,priority:'normal',assigned_to:null,contractor_id:null,preferred_date:null,scheduled_date:null,completion_notes:null,title:'Pump repair',job_number:17,created_by:user.id}] as T[],rowCount:1};
      if(sql.startsWith('UPDATE jobs SET'))return {rows:[{id:'job-1',jobNumber:17,status:'completed',statusReason:null,priority:'normal',assignedTo:null,contractorId:null,preferredDate:null,scheduledDate:null,completionNotes:'Replaced seal',updatedAt:'2026-10-23T00:00:00.000Z'}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;
  const controller=new JobsController(db);

  await assert.rejects(()=>controller.update({user} as never,'job-1',{status:'completed'}),/Add completion details/);
  assert.equal(calls.some(call=>call.sql.startsWith('UPDATE jobs SET')),false);
  const result=await controller.update({user} as never,'job-1',{status:'completed',completionNotes:'Replaced seal'});
  const statusEvent=calls.find(call=>call.sql.includes("INSERT INTO job_events")&&call.values[3]==='status_changed');
  assert.equal(result.status,'completed');
  assert.ok(statusEvent);
  assert.deepEqual(statusEvent.values,['tenant-1','job-1','employee-1','status_changed','in_progress','completed',null]);
});

test('job creation rejects callers without create permission before database access', async()=>{
  const db={query:async()=>{throw new Error('Database must not be queried');}} as unknown as DatabaseService;
  await assert.rejects(
    ()=>new JobsController(db).create({user:{...user,permissions:['jobs.read']}} as never,{
      customerId:'customer-1',
      title:'Pump repair',
      description:'Pump is leaking',
      contactChannel:'phone',
      location:'Shop',
      reportedUrgency:'normal'
    }),
    /jobs\.create permission is required/
  );
});
