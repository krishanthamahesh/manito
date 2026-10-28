import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthUser } from '../src/auth.service';
import { DatabaseService } from '../src/database.service';
import { OrganizationSettingsController } from '../src/organization-settings.controller';

const admin:AuthUser={
  id:'admin-1',tenantId:'tenant-1',email:'admin@example.test',fullName:'Shop Admin',
  role:'admin',roleId:'admin-role',roleName:'Administrator',systemRole:'admin',permissions:['settings.manage','settings.read']
};

test('organization settings include tenant logo data for reports',async()=>{
  const db={
    query:async<T>(_sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.deepEqual(values,['tenant-1']);
      return {rows:[{shopName:'Manito Shop',address:'Main street',officeContactPhone:'0112345678',
        technicalContactPhone:'0771234567',contactEmail:null,timeZone:'UTC',
        phoneIntakeEnabled:true,walkInIntakeEnabled:true,colorTheme:'green',
        logoBase64:'iVBORw0KGgo=',logoContentType:'image/png'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const result=await new OrganizationSettingsController(db).get({user:admin} as never);
  assert.deepEqual(result,{
    shopName:'Manito Shop',address:'Main street',officeContactPhone:'0112345678',
    technicalContactPhone:'0771234567',contactEmail:null,timeZone:'UTC',
    phoneIntakeEnabled:true,walkInIntakeEnabled:true,colorTheme:'green',
    logoDataUrl:'data:image/png;base64,iVBORw0KGgo='
  });
});

test('authenticated employees can read the organization color theme without organization settings access',async()=>{
  const employee={...admin,systemRole:null,permissions:[]};
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/SELECT color_theme/);
      assert.deepEqual(values,['tenant-1']);
      return {rows:[{colorTheme:'blue'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  assert.deepEqual(await new OrganizationSettingsController(db).getTheme({user:employee} as never),{colorTheme:'blue'});
});

test('administrator can save the organization color theme',async()=>{
  let parameters:unknown[]=[];
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/color_theme=COALESCE\(\$10,color_theme\)/);
      parameters=values;
      return {rows:[{shopName:'Manito Shop',address:'Main street',officeContactPhone:'0112345678',
        technicalContactPhone:'0771234567',contactEmail:null,timeZone:'UTC',
        phoneIntakeEnabled:true,walkInIntakeEnabled:true,colorTheme:'violet',
        logoBase64:null,logoContentType:null}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const result=await new OrganizationSettingsController(db).update({user:admin} as never,{
    shopName:'Manito Shop',address:' Main street ',officeContactPhone:' 0112345678 ',
    technicalContactPhone:' 0771234567 ',timeZone:'UTC',phoneIntakeEnabled:true,walkInIntakeEnabled:true,colorTheme:'violet'
  });
  assert.equal(result.colorTheme,'violet');
  assert.deepEqual(parameters,['tenant-1','Manito Shop','Main street','0112345678','0771234567',null,'UTC',true,true,'violet']);
});

test('administrator can upload a verified tenant logo',async()=>{
  let values:unknown[]=[];
  const db={
    query:async<T>(sql:string,parameters:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/UPDATE tenants SET logo/);
      values=parameters;
      return {rows:[{id:'tenant-1'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x01]);
  assert.deepEqual(
    await new OrganizationSettingsController(db).uploadLogo({user:admin} as never,{buffer:png,mimetype:'image/png'}),
    {success:true}
  );
  assert.deepEqual(values,['tenant-1',png,'image/png']);
  await assert.rejects(
    ()=>new OrganizationSettingsController(db).uploadLogo({user:admin} as never,{buffer:Buffer.from('bad'),mimetype:'image/png'}),
    failure=>failure instanceof BadRequestException&&failure.message.includes('genuine')
  );
});

test('organization logo upload and removal require administrator access and scope to tenant',async()=>{
  const noQueryDb={query:async()=>{throw new Error('Database must not be queried');}} as unknown as DatabaseService;
  const controller=new OrganizationSettingsController(noQueryDb);
  const manager={...admin,systemRole:null,permissions:['settings.manage']};
  await assert.rejects(
    ()=>controller.uploadLogo({user:manager} as never,{buffer:Buffer.alloc(0),mimetype:'image/png'}),
    failure=>failure instanceof ForbiddenException
  );
  await assert.rejects(
    ()=>controller.removeLogo({user:manager} as never),
    failure=>failure instanceof ForbiddenException
  );

  let values:unknown[]=[];
  const scopedDb={
    query:async<T>(sql:string,parameters:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      assert.match(sql,/UPDATE tenants SET logo=NULL/);
      values=parameters;
      return {rows:[{id:'tenant-1'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  assert.deepEqual(await new OrganizationSettingsController(scopedDb).removeLogo({user:admin} as never),{success:true});
  assert.deepEqual(values,['tenant-1']);
});
