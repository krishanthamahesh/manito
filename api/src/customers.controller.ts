import { BadRequestException,Body,Controller,Get,NotFoundException,Param,Patch,Post,Query,Req,UseGuards } from '@nestjs/common';
import { IsEmail,IsOptional,IsString,MaxLength,MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';
import { pageResult, parsePagination } from './pagination';
class CustomerDto {
  @IsString() @MinLength(1) @MaxLength(120) fullName!:string;
  @IsOptional() @IsString() @MaxLength(40) phone?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsOptional() @IsString() @MaxLength(500) address?:string;
}
class UpdateCustomerDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) fullName?:string;
  @IsOptional() @IsString() @MaxLength(40) phone?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsOptional() @IsString() @MaxLength(500) address?:string;
}
interface UserRequest extends Request { user:AuthUser; }
@Controller('customers') @UseGuards(AuthGuard)
export class CustomersController {
  constructor(private readonly db:DatabaseService){}
  @Get() async list(@Req() req:UserRequest,@Query('search') search?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string){
    requirePermission(req.user,'customers.read');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId]; let where='tenant_id=$1';
    if(search?.trim()){values.push(`%${search.trim()}%`);where+=' AND (full_name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2 OR address ILIKE $2)';}
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total FROM customers WHERE ${where}`,values);
    const result=await this.db.query(`SELECT id,full_name AS "fullName",phone,email,address FROM customers WHERE ${where} ORDER BY lower(full_name),id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }
  @Post() async create(@Req() req:UserRequest,@Body() body:CustomerDto){
    requirePermission(req.user,'customers.write');
    const phone=body.phone?.trim()||null;const email=body.email?.trim().toLowerCase()||null;
    if(!phone&&!email) throw new BadRequestException('Enter a phone number or email address.');
    const result=await this.db.query('INSERT INTO customers(tenant_id,full_name,phone,email,address) VALUES($1,$2,$3,$4,$5) RETURNING id,full_name AS "fullName",phone,email,address',[req.user.tenantId,body.fullName.trim(),phone,email,body.address?.trim()||null]);return result.rows[0];
  }

  @Patch(':customerId')
  async update(@Req() req:UserRequest,@Param('customerId') customerId:string,@Body() body:UpdateCustomerDto){
    requirePermission(req.user,'customers.write');
    if(body.fullName===undefined&&body.phone===undefined&&body.email===undefined&&body.address===undefined){
      throw new BadRequestException('Provide at least one customer detail to update.');
    }
    if(body.fullName!==undefined&&!body.fullName.trim()) throw new BadRequestException('Enter a customer name.');
    const current=await this.db.query<{phone:string|null;email:string|null}>(
      'SELECT phone,email FROM customers WHERE id=$1 AND tenant_id=$2',[customerId,req.user.tenantId]);
    if(!current.rowCount) throw new NotFoundException('Customer was not found.');
    const phone=body.phone===undefined?current.rows[0].phone:body.phone.trim()||null;
    const email=body.email===undefined?current.rows[0].email:body.email.trim().toLowerCase()||null;
    if(!phone&&!email) throw new BadRequestException('A customer must have a phone number or email address.');
    const result=await this.db.query(`UPDATE customers SET full_name=COALESCE($3,full_name),
      phone=$4,email=$5,address=CASE WHEN $6 THEN $7 ELSE address END
      WHERE id=$1 AND tenant_id=$2 RETURNING id,full_name AS "fullName",phone,email,address`,
    [customerId,req.user.tenantId,body.fullName?.trim()||null,phone,email,body.address!==undefined,body.address?.trim()||null]);
    return result.rows[0];
  }
}
