import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { requireAdministrator } from './authorization';
import { DatabaseService } from './database.service';
import { isPermission, PERMISSIONS, PROTECTED_PERMISSIONS } from './permissions';

class SaveRoleDto {
  @IsString() @MinLength(1) @MaxLength(80) name!:string;
  @IsOptional() @IsString() @MaxLength(500) description?:string;
  @IsArray() @IsString({ each:true }) permissions!:string[];
}

interface UserRequest extends Request { user:AuthUser; }

@Controller('roles')
@UseGuards(AuthGuard)
export class RolesController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async list(@Req() req:UserRequest){
    requireAdministrator(req.user);
    const result=await this.db.query(`SELECT id,role_key AS "roleKey",name,description,system_role AS "systemRole",
        permissions,created_at AS "createdAt",updated_at AS "updatedAt"
      FROM roles WHERE tenant_id=$1 ORDER BY system_role NULLS LAST,lower(name)`,[req.user.tenantId]);
    return {roles:result.rows,availablePermissions:PERMISSIONS};
  }

  @Post()
  async create(@Req() req:UserRequest,@Body() body:SaveRoleDto){
    requireAdministrator(req.user);
    const {name,description,permissions}=this.validate(body);
    try{
      const result=await this.db.query(`INSERT INTO roles(tenant_id,role_key,name,description,permissions)
        VALUES($1,'custom-'||gen_random_uuid()::text,$2,$3,$4)
        RETURNING id,role_key AS "roleKey",name,description,system_role AS "systemRole",permissions,
          created_at AS "createdAt",updated_at AS "updatedAt"`,
      [req.user.tenantId,name,description,permissions]);
      return result.rows[0];
    }catch(error){
      if(this.isUniqueViolation(error)) throw new ConflictException('A role with this name already exists.');
      throw error;
    }
  }

  @Patch(':id')
  async update(@Req() req:UserRequest,@Param('id') id:string,@Body() body:SaveRoleDto){
    requireAdministrator(req.user);
    const {name,description,permissions}=this.validate(body);
    const result=await this.db.query(`UPDATE roles SET name=$3,description=$4,permissions=$5,updated_at=now()
      WHERE id=$1 AND tenant_id=$2 AND system_role IS NULL
      RETURNING id,role_key AS "roleKey",name,description,system_role AS "systemRole",permissions,
        created_at AS "createdAt",updated_at AS "updatedAt"`,
    [id,req.user.tenantId,name,description,permissions]);
    if(!result.rowCount){
      const role=await this.db.query('SELECT id FROM roles WHERE id=$1 AND tenant_id=$2',[id,req.user.tenantId]);
      if(!role.rowCount) throw new NotFoundException('Role was not found.');
      throw new ForbiddenException('Built-in roles cannot be changed.');
    }
    return result.rows[0];
  }

  @Delete(':id')
  async remove(@Req() req:UserRequest,@Param('id') id:string){
    requireAdministrator(req.user);
    return this.db.transaction(async client=>{
      const role=await client.query<{id:string;system_role:string|null}>(
        'SELECT id,system_role FROM roles WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,req.user.tenantId]);
      if(!role.rowCount) throw new NotFoundException('Role was not found.');
      if(role.rows[0].system_role) throw new ForbiddenException('Built-in roles cannot be deleted.');
      const assigned=await client.query<{count:string}>('SELECT count(*)::text AS count FROM users WHERE role_id=$1',[id]);
      if(Number(assigned.rows[0]?.count??0)>0) throw new BadRequestException('Reassign employees before deleting this role.');
      await client.query('DELETE FROM roles WHERE id=$1 AND tenant_id=$2',[id,req.user.tenantId]);
      return {id};
    });
  }

  private validate(body:SaveRoleDto):{name:string;description:string;permissions:string[]}{
    const name=body.name.trim();
    if(!name) throw new BadRequestException('Enter a role name.');
    if(new Set(body.permissions).size!==body.permissions.length) throw new BadRequestException('Remove duplicate permissions.');
    const invalid=body.permissions.filter(permission=>!isPermission(permission));
    if(invalid.length) throw new BadRequestException(`Unknown permission: ${invalid[0]}.`);
    const protectedPermission=body.permissions.find(permission=>(PROTECTED_PERMISSIONS as readonly string[]).includes(permission));
    if(protectedPermission) throw new BadRequestException(`The ${protectedPermission} permission is reserved for the protected Administrator role.`);
    return {name,description:body.description?.trim()||'',permissions:body.permissions};
  }

  private isUniqueViolation(error:unknown):boolean{
    return typeof error==='object'&&error!==null&&'code' in error&&error.code==='23505';
  }
}
