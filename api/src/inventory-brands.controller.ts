import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { requirePermission } from './authorization';
import { DatabaseService } from './database.service';
import { pageResult, parsePagination } from './pagination';

class InventoryBrandDto {
  @IsString() @MinLength(1) @MaxLength(120) name!:string;
}
class UpdateInventoryBrandDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?:string;
  @IsOptional() @IsBoolean() active?:boolean;
}
interface UserRequest extends Request { user:AuthUser; }

@Controller('inventory/brands')
@UseGuards(AuthGuard)
export class InventoryBrandsController {
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
      filters.push(`name ILIKE $${values.length}`);
    }
    const where=filters.join(' AND ');
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total FROM inventory_brands WHERE ${where}`,values);
    const result=await this.db.query(`SELECT id,name,active,created_at AS "createdAt",updated_at AS "updatedAt"
      FROM inventory_brands WHERE ${where} ORDER BY active DESC,lower(name),id LIMIT $${values.length+1} OFFSET $${values.length+2}`,
    [...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }

  @Post()
  async create(@Req() req:UserRequest,@Body() body:InventoryBrandDto){
    requirePermission(req.user,'inventory.write');
    const name=body.name.trim();
    if(!name) throw new BadRequestException('Enter a brand name.');
    try{
      const result=await this.db.query(`INSERT INTO inventory_brands(tenant_id,name)
        VALUES($1,$2) RETURNING id,name,active,created_at AS "createdAt",updated_at AS "updatedAt"`,
      [req.user.tenantId,name]);
      return result.rows[0];
    }catch(error){
      if((error as {code?:string}).code==='23505') throw new BadRequestException('A brand with this name already exists.');
      throw error;
    }
  }

  @Patch(':brandId')
  async update(@Req() req:UserRequest,@Param('brandId') brandId:string,@Body() body:UpdateInventoryBrandDto){
    requirePermission(req.user,'inventory.write');
    if(body.name===undefined&&body.active===undefined) throw new BadRequestException('Provide a brand name or active state to update.');
    if(body.name!==undefined&&!body.name.trim()) throw new BadRequestException('Enter a brand name.');
    try{
      const result=await this.db.query(`UPDATE inventory_brands SET name=COALESCE($3,name),
        active=COALESCE($4,active),updated_at=now()
        WHERE id=$1 AND tenant_id=$2
        RETURNING id,name,active,created_at AS "createdAt",updated_at AS "updatedAt"`,
      [brandId,req.user.tenantId,body.name?.trim()||null,body.active??null]);
      if(!result.rowCount) throw new NotFoundException('Brand was not found.');
      return result.rows[0];
    }catch(error){
      if((error as {code?:string}).code==='23505') throw new BadRequestException('A brand with this name already exists.');
      throw error;
    }
  }
}
