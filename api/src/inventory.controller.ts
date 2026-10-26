import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';
import { pageResult, parsePagination } from './pagination';

class CreateInventoryItemDto {
  @IsString() @MinLength(1) @MaxLength(80) sku!:string;
  @IsString() @MinLength(1) @MaxLength(160) name!:string;
  @IsOptional() @IsUUID() vendorId?:string;
  @IsOptional() @IsUUID() brandId?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) unit?:string;
  @IsOptional() @IsNumber({maxDecimalPlaces:3}) @Min(0) @Max(999999999) openingStock?:number;
  @IsOptional() @IsNumber({maxDecimalPlaces:3}) @Min(0) @Max(999999999) reorderLevel?:number;
}
class InventoryMovementDto {
  @IsIn(['receipt','adjustment']) type!:'receipt'|'adjustment';
  @IsNumber({maxDecimalPlaces:3}) @Max(999999999) @Min(-999999999) quantity!:number;
  @IsOptional() @IsString() @MaxLength(1000) notes?:string;
}
interface UserRequest extends Request { user:AuthUser; }

@Controller('inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async list(@Req() req:UserRequest,@Query('search') search?:string,@Query('includeInactive') includeInactive?:string,@Query('lowStockOnly') lowStockOnly?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string){
    requirePermission(req.user,'inventory.read');
    if(includeInactive==='true') requirePermission(req.user,'inventory.write');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId];
    const filters=['i.tenant_id=$1'];
    if(includeInactive!=='true') filters.push('i.active=true');
    if(lowStockOnly==='true') filters.push('i.stock_quantity<=i.reorder_level');
    if(search?.trim()){
      values.push(`%${search.trim()}%`);
      filters.push(`(i.name ILIKE $${values.length} OR i.sku ILIKE $${values.length})`);
    }
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total FROM inventory_items i WHERE ${filters.join(' AND ')}`,values);
    const result=await this.db.query(`SELECT i.id,i.sku,i.name,i.vendor_id AS "vendorId",v.name AS "vendorName",i.brand_id AS "brandId",b.name AS "brandName",i.unit,i.stock_quantity::float8 AS "stockQuantity",i.reorder_level::float8 AS "reorderLevel",i.active,i.created_at AS "createdAt",i.updated_at AS "updatedAt",(i.stock_quantity<=i.reorder_level) AS "lowStock"
      FROM inventory_items i LEFT JOIN inventory_vendors v ON v.id=i.vendor_id AND v.tenant_id=i.tenant_id
      LEFT JOIN inventory_brands b ON b.id=i.brand_id AND b.tenant_id=i.tenant_id
      WHERE ${filters.join(' AND ')} ORDER BY lower(i.name),i.sku LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }

  @Get(':id/movements')
  async movements(@Req() req:UserRequest,@Param('id') id:string){
    requirePermission(req.user,'inventory.read');
    const item=await this.db.query('SELECT id FROM inventory_items WHERE id=$1 AND tenant_id=$2',[id,req.user.tenantId]);
    if(!item.rowCount) throw new BadRequestException('Inventory item was not found.');
    const result=await this.db.query(`SELECT m.id,m.movement_type AS "movementType",m.quantity::float8 AS quantity,m.notes,m.created_at AS "createdAt",u.full_name AS "actorName",j.job_number AS "jobNumber"
      FROM inventory_movements m
      JOIN users u ON u.id=m.actor_id AND u.tenant_id=m.tenant_id
      LEFT JOIN jobs j ON j.id=m.job_id AND j.tenant_id=m.tenant_id
      WHERE m.item_id=$1 AND m.tenant_id=$2 ORDER BY m.created_at DESC LIMIT 200`,[id,req.user.tenantId]);
    return result.rows;
  }

  @Post()
  async create(@Req() req:UserRequest,@Body() body:CreateInventoryItemDto){
    requirePermission(req.user,'inventory.write');
    const sku=body.sku.trim();
    const name=body.name.trim();
    const unit=body.unit?.trim()||'each';
    if(!sku||!name||!unit) throw new BadRequestException('SKU, item name, and unit are required.');
    const openingStock=body.openingStock??0;
    return this.db.transaction(async client=>{
      if(body.vendorId){
        const vendor=await client.query('SELECT id FROM inventory_vendors WHERE id=$1 AND tenant_id=$2 AND active=true',[body.vendorId,req.user.tenantId]);
        if(!vendor.rowCount) throw new BadRequestException('Select an active vendor from your organization.');
      }
      if(body.brandId){
        const brand=await client.query('SELECT id FROM inventory_brands WHERE id=$1 AND tenant_id=$2 AND active=true',[body.brandId,req.user.tenantId]);
        if(!brand.rowCount) throw new BadRequestException('Select an active brand from your organization.');
      }
      const result=await client.query(`INSERT INTO inventory_items(tenant_id,vendor_id,brand_id,sku,name,unit,stock_quantity,reorder_level)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(tenant_id,sku) DO NOTHING
        RETURNING id,sku,name,vendor_id AS "vendorId",brand_id AS "brandId",unit,stock_quantity::float8 AS "stockQuantity",reorder_level::float8 AS "reorderLevel",active`,
      [req.user.tenantId,body.vendorId??null,body.brandId??null,sku,name,unit,openingStock,body.reorderLevel??0]);
      const item=result.rows[0];
      if(!item) throw new BadRequestException('An inventory item with this SKU already exists.');
      if(openingStock>0){
        await client.query(`INSERT INTO inventory_movements(tenant_id,item_id,actor_id,movement_type,quantity,notes)
          VALUES($1,$2,$3,'receipt',$4,'Opening stock')`,[req.user.tenantId,item.id,req.user.id,openingStock]);
      }
      const vendor=body.vendorId?await client.query<{name:string}>('SELECT name FROM inventory_vendors WHERE id=$1 AND tenant_id=$2',[body.vendorId,req.user.tenantId]):null;
      const brand=body.brandId?await client.query<{name:string}>('SELECT name FROM inventory_brands WHERE id=$1 AND tenant_id=$2',[body.brandId,req.user.tenantId]):null;
      return {...item,vendorName:vendor?.rows[0]?.name??null,brandName:brand?.rows[0]?.name??null,lowStock:openingStock<=(body.reorderLevel??0)};
    });
  }

  @Post(':id/movements')
  async addMovement(@Req() req:UserRequest,@Param('id') id:string,@Body() body:InventoryMovementDto){
    requirePermission(req.user,'inventory.write');
    if(body.quantity===0) throw new BadRequestException('Movement quantity cannot be zero.');
    if(body.type==='receipt'&&body.quantity<=0) throw new BadRequestException('A stock receipt quantity must be positive.');
    if(body.type==='adjustment'&&body.quantity<0&&!body.notes?.trim()) throw new BadRequestException('Add a reason for reducing stock.');
    return this.db.transaction(async client=>{
      const current=await client.query<{stock_quantity:string}>('SELECT stock_quantity FROM inventory_items WHERE id=$1 AND tenant_id=$2 AND active=true FOR UPDATE',[id,req.user.tenantId]);
      if(!current.rowCount) throw new BadRequestException('Active inventory item was not found.');
      const next=Number(current.rows[0].stock_quantity)+body.quantity;
      if(next<0) throw new BadRequestException('Stock cannot be reduced below zero.');
      const notes=body.notes?.trim()||(body.type==='receipt'?'Stock received':null);
      const updated=await client.query(`UPDATE inventory_items SET stock_quantity=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2
        RETURNING id,sku,name,unit,stock_quantity::float8 AS "stockQuantity",reorder_level::float8 AS "reorderLevel",active,(stock_quantity<=reorder_level) AS "lowStock"`,
      [id,req.user.tenantId,next]);
      const movement=await client.query(`INSERT INTO inventory_movements(tenant_id,item_id,actor_id,movement_type,quantity,notes)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,movement_type AS "movementType",quantity::float8 AS quantity,notes,created_at AS "createdAt"`,
      [req.user.tenantId,id,req.user.id,body.type,body.quantity,notes]);
      return {...updated.rows[0],movement:movement.rows[0]};
    });
  }
}
