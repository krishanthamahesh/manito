import { BadRequestException,Body,Controller,Get,NotFoundException,Param,Patch,Post,Query,Req,UseGuards } from '@nestjs/common';
import { IsBoolean,IsEmail,IsOptional,IsString,MaxLength,MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';
import { pageResult, parsePagination } from './pagination';

class ContractorDto {
  @IsString() @MinLength(1) @MaxLength(120) name!:string;
  @IsOptional() @IsString() @MaxLength(40) phone?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsOptional() @IsString() @MaxLength(1000) notes?:string;
}
class UpdateContractorDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?:string;
  @IsOptional() @IsString() @MaxLength(40) phone?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsOptional() @IsString() @MaxLength(1000) notes?:string;
  @IsOptional() @IsBoolean() active?:boolean;
}
interface UserRequest extends Request { user:AuthUser; }

@Controller('contractors')
@UseGuards(AuthGuard)
export class ContractorsController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async list(@Req() req:UserRequest,@Query('search') search?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string){
    requirePermission(req.user,'jobs.update');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId];
    let where='tenant_id=$1';
    if(search?.trim()){values.push(`%${search.trim()}%`);where+=' AND (name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)';}
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total FROM contractors WHERE ${where}`,values);
    const result=await this.db.query(`SELECT id,name,phone,email,notes,active,created_at AS "createdAt"
      FROM contractors WHERE ${where} ORDER BY active DESC,lower(name),id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }

  @Post()
  async create(@Req() req:UserRequest,@Body() body:ContractorDto){
    requirePermission(req.user,'settings.manage');
    const name=body.name.trim();
    if(!name) throw new BadRequestException('Enter a contractor name.');
    const result=await this.db.query(`INSERT INTO contractors(tenant_id,name,phone,email,notes)
      VALUES($1,$2,$3,$4,$5)
      RETURNING id,name,phone,email,notes,active,created_at AS "createdAt"`,
    [req.user.tenantId,name,body.phone?.trim()||null,body.email?.trim().toLowerCase()||null,body.notes?.trim()||null]);
    return result.rows[0];
  }

  @Patch(':contractorId')
  async update(@Req() req:UserRequest,@Param('contractorId') contractorId:string,@Body() body:UpdateContractorDto){
    requirePermission(req.user,'settings.manage');
    if(body.name===undefined&&body.phone===undefined&&body.email===undefined&&body.notes===undefined&&body.active===undefined){
      throw new BadRequestException('Provide contractor details or an active state to update.');
    }
    if(body.name!==undefined&&!body.name.trim()) throw new BadRequestException('Enter a contractor name.');
    const result=await this.db.query(`UPDATE contractors SET name=COALESCE($3,name),
      phone=CASE WHEN $4 THEN $5 ELSE phone END,email=CASE WHEN $6 THEN $7 ELSE email END,
      notes=CASE WHEN $8 THEN $9 ELSE notes END,active=COALESCE($10,active),updated_at=now()
      WHERE id=$1 AND tenant_id=$2
      RETURNING id,name,phone,email,notes,active,created_at AS "createdAt"`,
    [contractorId,req.user.tenantId,body.name?.trim()||null,body.phone!==undefined,body.phone?.trim()||null,
      body.email!==undefined,body.email?.trim().toLowerCase()||null,body.notes!==undefined,body.notes?.trim()||null,
      body.active??null]);
    if(!result.rowCount) throw new NotFoundException('Contractor was not found.');
    return result.rows[0];
  }
}
