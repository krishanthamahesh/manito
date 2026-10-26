import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { AuthUser } from '../src/auth.service';
import { DatabaseService } from '../src/database.service';
import { InventoryController } from '../src/inventory.controller';
import { InventoryBrandsController } from '../src/inventory-brands.controller';
import { InventoryVendorsController } from '../src/inventory-vendors.controller';
import { PoolClient } from 'pg';

const user:AuthUser={
  id:'manager-1',
  tenantId:'tenant-1',
  email:'manager@example.test',
  fullName:'Test Manager',
  role:'manager',
  roleId:'role-1',
  roleName:'Manager',
  systemRole:null,
  permissions:['inventory.read','inventory.write']
};

test('inventory vendor create stores the vendor under the caller tenant',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      return {rows:[{id:'vendor-1',name:'Parts Co',active:true}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;

  const result=await new InventoryVendorsController(db).create({user} as never,{name:' Parts Co ',phone:' 555-0100 '});

  assert.equal(result.id,'vendor-1');
  assert.match(calls[0].sql,/INSERT INTO inventory_vendors/);
  assert.deepEqual(calls[0].values,['tenant-1','Parts Co',null,'555-0100',null,null]);
});

test('vendor list is restricted to active rows by default and scoped to tenant',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      return {rows:(sql.includes('count(*)')?[{total:'1'}]:[{id:'vendor-1',name:'Parts Co',active:true}]) as T[],rowCount:1};
    }
  } as unknown as DatabaseService;

  const result=await new InventoryVendorsController(db).list({user} as never,undefined,'Parts','1','10');

  assert.equal(result.total,1);
  assert.deepEqual(calls[0].values,['tenant-1','%Parts%']);
  assert.match(calls[0].sql,/tenant_id=\$1 AND active=true/);
});

test('inventory item creation rejects an inactive or cross-tenant vendor',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      return {rows:[] as T[],rowCount:0};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;

  await assert.rejects(
    ()=>new InventoryController(db).create({user} as never,{sku:'BELT-1',name:'Drive belt',vendorId:'vendor-other'}),
    (failure:unknown)=>failure instanceof BadRequestException&&failure.message.includes('active vendor')
  );
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].values,['vendor-other','tenant-1']);
});

test('inventory brand create stores the brand under the caller tenant',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      return {rows:[{id:'brand-1',name:'Acme',active:true}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;

  const result=await new InventoryBrandsController(db).create({user} as never,{name:' Acme '});

  assert.equal(result.id,'brand-1');
  assert.match(calls[0].sql,/INSERT INTO inventory_brands/);
  assert.deepEqual(calls[0].values,['tenant-1','Acme']);
});

test('inventory item creation persists a selected vendor id',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT name FROM inventory_vendors'))return {rows:[{name:'Parts Co'}] as T[],rowCount:1};
      if(sql.includes('FROM inventory_vendors'))return {rows:[{id:'vendor-1'}] as T[],rowCount:1};
      if(sql.startsWith('INSERT INTO inventory_items'))return {rows:[{id:'item-1',vendorId:'vendor-1',stockQuantity:3}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;

  const item=await new InventoryController(db).create({user} as never,{sku:'BELT-1',name:'Drive belt',vendorId:'vendor-1',openingStock:3});

  assert.equal(item.vendorId,'vendor-1');
  assert.equal(item.vendorName,'Parts Co');
  const insert=calls.find(call=>call.sql.startsWith('INSERT INTO inventory_items'));
  assert.ok(insert);
  assert.deepEqual(insert.values,['tenant-1','vendor-1',null,'BELT-1','Drive belt','each',3,0]);
});

test('inventory item creation validates and saves the selected brand',async()=>{
  const calls:{sql:string;values:unknown[]}[]=[];
  const client={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      calls.push({sql,values});
      if(sql.startsWith('SELECT name FROM inventory_brands'))return {rows:[{name:'Acme'}] as T[],rowCount:1};
      if(sql.includes('FROM inventory_brands'))return {rows:[{id:'brand-1'}] as T[],rowCount:1};
      if(sql.startsWith('INSERT INTO inventory_items'))return {rows:[{id:'item-1',brandId:'brand-1',stockQuantity:0}] as T[],rowCount:1};
      return {rows:[] as T[],rowCount:1};
    }
  };
  const db={
    transaction:async<T>(work:(transactionClient:PoolClient)=>Promise<T>)=>work(client as unknown as PoolClient)
  } as unknown as DatabaseService;

  const item=await new InventoryController(db).create({user} as never,{sku:'BELT-2',name:'Timing belt',brandId:'brand-1'});

  assert.equal(item.brandId,'brand-1');
  assert.equal(item.brandName,'Acme');
  const insert=calls.find(call=>call.sql.startsWith('INSERT INTO inventory_items'));
  assert.ok(insert);
  assert.deepEqual(insert.values,['tenant-1',null,'brand-1','BELT-2','Timing belt','each',0,0]);
});
