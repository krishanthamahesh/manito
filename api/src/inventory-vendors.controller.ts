import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { requirePermission } from './authorization';
import { DatabaseService } from './database.service';
import { pageResult, parsePagination } from './pagination';

class InventoryVendorDto {
  @IsString() @MinLength(1) @MaxLength(160) name!:string;
  @IsOptional() @IsString() @MaxLength(120) contactName?:string;
  @IsOptional() @IsString() @MaxLength(40) phone?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsOptional() @IsString() @MaxLength(1000) notes?:string;
}
class UpdateInventoryVendorDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?:string;
  @IsOptional() @IsString() @MaxLength(120) contactName?:string;
  @IsOptional() @IsString() @MaxLength(40) phone?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsOptional() @IsString() @MaxLength(1000) notes?:string;
  @IsOptional() @IsBoolean() active?:boolean;
}
interface UserRequest extends Request { user:AuthUser; }

@Controller('inventory/vendors')
@UseGuards(AuthGuard)
export class InventoryVendorsController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async list(@Req() req:UserRequest,@Query('includeInactive') includeInactive?:string,@Query('search') search?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string){
    requirePermission(req.user,'inventory.write');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId];
    const filters=['tenant_id=$1'];
    if(includeInactive!=='true') filters.push('active=true');
    if(search?.trim()){
      values.push(`%${search.trim()}%`);
      filters.push(`(name ILIKE $${values.length} OR contact_name ILIKE $${values.length} OR phone ILIKE $${values.length} OR email ILIKE $${values.length})`);
    }
    const where=filters.join(' AND ');
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total FROM inventory_vendors WHERE ${where}`,values);
    const result=await this.db.query(`SELECT id,name,contact_name AS "contactName",phone,email,notes,active,created_at AS "createdAt",updated_at AS "updatedAt"
      FROM inventory_vendors WHERE ${where} ORDER BY active DESC,lower(name),id LIMIT $${values.length+1} OFFSET $${values.length+2}`,
    [...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }

  @Post()
  async create(@Req() req:UserRequest,@Body() body:InventoryVendorDto){
    requirePermission(req.user,'inventory.write');
    const name=body.name.trim();
    if(!name) throw new BadRequestException('Enter a vendor name.');
    const result=await this.db.query(`INSERT INTO inventory_vendors(tenant_id,name,contact_name,phone,email,notes)
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING id,name,contact_name AS "contactName",phone,email,notes,active,created_at AS "createdAt",updated_at AS "updatedAt"`,
    [req.user.tenantId,name,body.contactName?.trim()||null,body.phone?.trim()||null,body.email?.trim().toLowerCase()||null,body.notes?.trim()||null]);
    return result.rows[0];
  }

  @Patch(':vendorId')
  async update(@Req() req:UserRequest,@Param('vendorId') vendorId:string,@Body() body:UpdateInventoryVendorDto){
    requirePermission(req.user,'inventory.write');
    if(body.name===undefined&&body.contactName===undefined&&body.phone===undefined&&body.email===undefined&&body.notes===undefined&&body.active===undefined){
      throw new BadRequestException('Provide vendor details or an active state to update.');
    }
    if(body.name!==undefined&&!body.name.trim()) throw new BadRequestException('Enter a vendor name.');
    const result=await this.db.query(`UPDATE inventory_vendors SET name=COALESCE($3,name),
      contact_name=CASE WHEN $4 THEN $5 ELSE contact_name END,phone=CASE WHEN $6 THEN $7 ELSE phone END,
      email=CASE WHEN $8 THEN $9 ELSE email END,notes=CASE WHEN $10 THEN $11 ELSE notes END,
      active=COALESCE($12,active),updated_at=now()
      WHERE id=$1 AND tenant_id=$2
      RETURNING id,name,contact_name AS "contactName",phone,email,notes,active,created_at AS "createdAt",updated_at AS "updatedAt"`,
    [vendorId,req.user.tenantId,body.name?.trim()||null,body.contactName!==undefined,body.contactName?.trim()||null,
      body.phone!==undefined,body.phone?.trim()||null,body.email!==undefined,body.email?.trim().toLowerCase()||null,
      body.notes!==undefined,body.notes?.trim()||null,body.active??null]);
    if(!result.rowCount) throw new NotFoundException('Vendor was not found.');
    return result.rows[0];
  }
}
