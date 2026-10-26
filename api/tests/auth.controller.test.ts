import assert from 'node:assert/strict';
import test from 'node:test';
import { AuthController } from '../src/auth.controller';
import { AuthService } from '../src/auth.service';
import { DatabaseService } from '../src/database.service';

test('login branding lookup uses the email to retrieve its organization logo',async()=>{
  let values:unknown[]=[];
  const db={
    query:async<T>(_sql:string,parameters:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      values=parameters;
      return {rows:[{shop_name:'Service Shop',color_theme:'blue',logo_base64:'iVBORw0KGgo=',logo_content_type:'image/png'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const controller=new AuthController({} as AuthService,db);
  assert.deepEqual(
    await controller.branding({email:' ADMIN@EXAMPLE.TEST '}),
    {shopName:'Service Shop',colorTheme:'blue',logoDataUrl:'data:image/png;base64,iVBORw0KGgo='}
  );
  assert.deepEqual(values,['admin@example.test']);
});

test('login branding is empty when an email has no active employee account',async()=>{
  const db={
    query:async<T>():Promise<{rows:T[];rowCount:number}>=>({rows:[] as T[],rowCount:0})
  } as unknown as DatabaseService;
  const controller=new AuthController({} as AuthService,db);
  assert.deepEqual(await controller.branding({email:'unknown@example.test'}),{shopName:null,colorTheme:'green',logoDataUrl:null});
});

test('login branding can load the default organization before an email is entered',async()=>{
  let query='';
  const db={
    query:async<T>(sql:string,values:unknown[]=[]):Promise<{rows:T[];rowCount:number}>=>{
      query=sql;
      assert.deepEqual(values,[]);
      return {rows:[{shop_name:'Default Shop',color_theme:'amber',logo_base64:'logo-data',logo_content_type:'image/webp'}] as T[],rowCount:1};
    }
  } as unknown as DatabaseService;
  const controller=new AuthController({} as AuthService,db);
  assert.deepEqual(await controller.branding({}),{
    shopName:'Default Shop',colorTheme:'amber',logoDataUrl:'data:image/webp;base64,logo-data'
  });
  assert.match(query,/FROM tenants ORDER BY created_at,id LIMIT 1/);
});
