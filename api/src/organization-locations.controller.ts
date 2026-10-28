import { BadRequestException,Body,Controller,Get,NotFoundException,Param,Patch,Post,Query,Req,UseGuards } from '@nestjs/common';
import { IsBoolean,IsOptional,IsString,MaxLength,MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { hasPermission,requirePermission } from './authorization';
import { pageResult, parsePagination } from './pagination';

class OrganizationLocationDto {
  @IsString() @MinLength(1) @MaxLength(120) name!:string;
  @IsString() @MinLength(1) @MaxLength(500) address!:string;
}
class UpdateOrganizationLocationDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) address?:string;
  @IsOptional() @IsBoolean() active?:boolean;
}
interface UserRequest extends Request { user:AuthUser; }

@Controller('organization-locations')
@UseGuards(AuthGuard)
export class OrganizationLocationsController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async list(@Req() req:UserRequest,@Query('includeInactive') includeInactive?:string,@Query('search') search?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string){
    requirePermission(req.user,'locations.read');
    const showInactive=includeInactive==='true'&&hasPermission(req.user,'locations.manage');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId];
    let where=`tenant_id=$1${showInactive?'':' AND active=true'}`;
    if(search?.trim()){values.push(`%${search.trim()}%`);where+=` AND (name ILIKE $${values.length} OR address ILIKE $${values.length})`;}
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total FROM organization_locations WHERE ${where}`,values);
    const result=await this.db.query(`SELECT id,name,address,active,created_at AS "createdAt"
      FROM organization_locations WHERE ${where}
      ORDER BY active DESC,lower(name),id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }

  @Post()
  async create(@Req() req:UserRequest,@Body() body:OrganizationLocationDto){
    requirePermission(req.user,'locations.manage');
    const name=body.name.trim(),address=body.address.trim();
    if(!name||!address) throw new BadRequestException('Enter a location name and address.');
    const result=await this.db.query(`INSERT INTO organization_locations(tenant_id,name,address)
      VALUES($1,$2,$3) RETURNING id,name,address,active,created_at AS "createdAt"`,
    [req.user.tenantId,name,address]);
    return result.rows[0];
  }

  @Patch(':locationId')
  async update(@Req() req:UserRequest,@Param('locationId') locationId:string,@Body() body:UpdateOrganizationLocationDto){
    requirePermission(req.user,'locations.manage');
    if(body.name===undefined&&body.address===undefined&&body.active===undefined){
      throw new BadRequestException('Provide location details or an active state to update.');
    }
    if(body.name!==undefined&&!body.name.trim()) throw new BadRequestException('Enter a location name.');
    if(body.address!==undefined&&!body.address.trim()) throw new BadRequestException('Enter a location address.');
    const result=await this.db.query(`UPDATE organization_locations SET name=COALESCE($3,name),
      address=COALESCE($4,address),active=COALESCE($5,active),updated_at=now()
      WHERE id=$1 AND tenant_id=$2 RETURNING id,name,address,active,created_at AS "createdAt"`,
    [locationId,req.user.tenantId,body.name?.trim()||null,body.address?.trim()||null,body.active??null]);
    if(!result.rowCount) throw new NotFoundException('Organization location was not found.');
    return result.rows[0];
  }
}
