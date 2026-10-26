import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomersController } from '../src/customers.controller';
import { AuthUser } from '../src/auth.service';
import { DatabaseService } from '../src/database.service';

const user:AuthUser={
  id:'employee-1',
  tenantId:'tenant-1',
  email:'employee@example.test',
  fullName:'Test Employee',
  role:'employee',
  roleId:'role-1',
  roleName:'Employee',
  systemRole:null,
  permissions:['customers.read']
};

test('customer search is tenant-scoped and returns a paginated envelope', async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      return {rows:(sql.includes('count(*)')?[{total:'51'}]:[{id:'customer-1',fullName:'Asha Perera'}]) as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const controller=new CustomersController(db);
  const result=await controller.list({user} as never,'Asha','2','25');

  assert.deepEqual(result,{items:[{id:'customer-1',fullName:'Asha Perera'}],total:51,page:2,pageSize:25,totalPages:3});
  assert.deepEqual(calls[0].values,['tenant-1','%Asha%']);
  assert.match(calls[0].sql,/tenant_id=\$1/);
  assert.deepEqual(calls[1].values,['tenant-1','%Asha%',25,25]);
  assert.match(calls[1].sql,/LIMIT \$3 OFFSET \$4/);
});

test('customer listing rejects a user without customer-read permission', async()=>{
  const db={query:async()=>{throw new Error('Database must not be queried');}} as unknown as DatabaseService;
  const controller=new CustomersController(db);
  await assert.rejects(()=>controller.list({user:{...user,permissions:[]}} as never),/customers\.read permission is required/);
});
