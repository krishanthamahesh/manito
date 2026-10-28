import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPermission } from '../src/authorization';
import { isPermission, PROTECTED_PERMISSIONS } from '../src/permissions';

test('location and contractor page permissions can be assigned to custom roles',()=>{
  for(const permission of ['locations.read','locations.manage','contractors.read','contractors.manage']){
    assert.equal(isPermission(permission),true);
    assert.equal((PROTECTED_PERMISSIONS as readonly string[]).includes(permission),false);
  }
});

test('job permissions retain the location and contractor lookups needed for daily work',()=>{
  const user={
    id:'employee-1',tenantId:'tenant-1',email:'employee@example.test',fullName:'Test Employee',
    role:'employee',roleId:'role-1',roleName:'Employee',systemRole:null,
    permissions:['jobs.create','jobs.update']
  };
  assert.equal(hasPermission(user,'locations.read'),true);
  assert.equal(hasPermission(user,'contractors.read'),true);
});

test('managing locations or contractors implies permission to view them',()=>{
  const user={
    id:'employee-1',tenantId:'tenant-1',email:'employee@example.test',fullName:'Test Employee',
    role:'employee',roleId:'role-1',roleName:'Employee',systemRole:null,
    permissions:['locations.manage','contractors.manage']
  };
  assert.equal(hasPermission(user,'locations.read'),true);
  assert.equal(hasPermission(user,'contractors.read'),true);
});
