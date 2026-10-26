import { BadRequestException,Body,ConflictException,Controller,Delete,Get,NotFoundException,Param,Patch,Post,Query,Req,UploadedFile,UseFilters,UseGuards,UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean,IsEmail,IsOptional,IsString,IsUUID,MaxLength,MinLength } from 'class-validator';
import { Request } from 'express';
import * as bcrypt from 'bcryptjs';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { requirePermission } from './authorization';
import { DatabaseService } from './database.service';
import { Permission } from './permissions';
import { pageResult, parsePagination } from './pagination';
import { ImageUploadExceptionFilter } from './image-upload.filter';
const MAX_PROFILE_PICTURE_SIZE=2*1024*1024;
interface UploadedProfilePicture{buffer:Buffer;mimetype:string;}
interface StoredProfilePicture{profile_picture_base64:string|null;profile_picture_content_type:string|null;}
class CreateEmployeeDto{
  @IsString() @MinLength(1) @MaxLength(120) fullName!:string;
  @IsEmail() @MaxLength(254) email!:string;
  @IsString() @MinLength(12) @MaxLength(128) password!:string;
  @IsUUID() roleId!:string;
}
class UpdateEmployeeDto{
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) fullName?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
  @IsOptional() @IsBoolean() active?:boolean;
  @IsOptional() @IsUUID() roleId?:string;
}
class SelfProfileDto{
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) fullName?:string;
  @IsOptional() @IsEmail() @MaxLength(254) email?:string;
}
class ChangePasswordDto{
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!:string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword!:string;
}
class TemporaryPasswordDto{
  @IsString() @MinLength(12) @MaxLength(128) password!:string;
}
interface UserRequest extends Request { user:AuthUser; }
@Controller('team') @UseGuards(AuthGuard)
export class TeamController {
  constructor(private readonly db:DatabaseService){}
  private require(user:AuthUser,permission:Permission):void{requirePermission(user,permission);}
  @Get() async list(@Req() req:UserRequest,@Query('search') search?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string){
    this.require(req.user,'team.read');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId];
    let where='u.tenant_id=$1 AND u.active=true';
    if(search?.trim()){values.push(`%${search.trim()}%`);where+=` AND (u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`;}
    const from=`FROM users u JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id WHERE ${where}`;
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total ${from}`,values);
    const result=await this.db.query(`SELECT u.id,u.full_name AS "fullName",r.name AS role,r.id AS "roleId"
      ${from} ORDER BY lower(u.full_name),u.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }
  @Get('manage') async listForAdmin(@Req() req:UserRequest,@Query('search') search?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string){
    this.require(req.user,'team.manage');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId];
    let where='u.tenant_id=$1';
    if(search?.trim()){values.push(`%${search.trim()}%`);where+=` AND (u.full_name ILIKE $${values.length} OR u.email ILIKE $${values.length})`;}
    const from=`FROM users u JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id WHERE ${where}`;
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total ${from}`,values);
    const result=await this.db.query(`SELECT u.id,u.full_name AS "fullName",u.email,r.name AS role,r.id AS "roleId",
        r.system_role AS "systemRole",u.active,u.created_at AS "createdAt"
      ${from} ORDER BY u.active DESC,lower(u.full_name),u.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }
  @Post() async create(@Req() req:UserRequest,@Body() body:CreateEmployeeDto){
    this.require(req.user,'team.manage');
    const email=body.email.trim().toLowerCase();
    const role=await this.db.query<{id:string;name:string;system_role:string|null}>(
      'SELECT id,name,system_role FROM roles WHERE id=$1 AND tenant_id=$2',[body.roleId,req.user.tenantId]);
    if(!role.rowCount) throw new BadRequestException('Select a role from your organization.');
    const passwordHash=await bcrypt.hash(body.password,12);
    const result=await this.db.query(
      `INSERT INTO users(tenant_id,email,full_name,password_hash,role,role_id)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING
       RETURNING id,full_name AS "fullName",email,role_id AS "roleId",active,created_at AS "createdAt"`,
      [req.user.tenantId,email,body.fullName.trim(),passwordHash,role.rows[0].system_role??'employee',body.roleId]
    );
    if(!result.rowCount)throw new ConflictException('An employee with this email already exists.');
    return {...result.rows[0],role:role.rows[0].name};
  }
  @Patch('me/profile') async updateOwnProfile(@Req() req:UserRequest,@Body() body:SelfProfileDto){
    if(body.fullName===undefined&&body.email===undefined)throw new BadRequestException('Provide a name or email address to update.');
    if(body.fullName!==undefined&&!body.fullName.trim())throw new BadRequestException('Enter your name.');
    try{
      const result=await this.db.query(
        `UPDATE users SET full_name=COALESCE($3,full_name),email=COALESCE($4,email)
         WHERE id=$1 AND tenant_id=$2 AND active=true
         RETURNING id,full_name AS "fullName",email`,
        [req.user.id,req.user.tenantId,body.fullName?.trim()||null,body.email?.trim().toLowerCase()||null]
      );
      if(!result.rowCount)throw new NotFoundException('Your employee account was not found.');
      return result.rows[0];
    }catch(error){
      if((error as {code?:string}).code==='23505')throw new ConflictException('An employee with this email already exists.');
      throw error;
    }
  }
  @Get('me/photo') async getOwnPhoto(@Req() req:UserRequest){
    const result=await this.db.query<StoredProfilePicture>(
      "SELECT encode(profile_picture,'base64') AS profile_picture_base64,profile_picture_content_type FROM users WHERE id=$1 AND tenant_id=$2 AND active=true",
      [req.user.id,req.user.tenantId]
    );
    const picture=result.rows[0];
    return {photoDataUrl:picture?.profile_picture_base64&&picture.profile_picture_content_type
      ?`data:${picture.profile_picture_content_type};base64,${picture.profile_picture_base64}`
      :null};
  }
  @Post('me/photo')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_PROFILE_PICTURE_SIZE,files:1,fields:3,parts:5}}))
  @UseFilters(ImageUploadExceptionFilter)
  async saveOwnPhoto(@Req() req:UserRequest,@UploadedFile() file?:UploadedProfilePicture){
    if(!file)throw new BadRequestException('Choose a profile picture to upload.');
    const contentType=this.detectImageType(file.buffer);
    if(!contentType||contentType!==file.mimetype)throw new BadRequestException('Use a genuine JPEG, PNG, or WebP image.');
    const result=await this.db.query(
      `UPDATE users SET profile_picture=$3,profile_picture_content_type=$4
       WHERE id=$1 AND tenant_id=$2 AND active=true RETURNING id`,
      [req.user.id,req.user.tenantId,file.buffer,contentType]
    );
    if(!result.rowCount)throw new NotFoundException('Your employee account was not found.');
    return {success:true};
  }
  @Delete('me/photo') async deleteOwnPhoto(@Req() req:UserRequest){
    const result=await this.db.query(
      `UPDATE users SET profile_picture=NULL,profile_picture_content_type=NULL
       WHERE id=$1 AND tenant_id=$2 AND active=true RETURNING id`,
      [req.user.id,req.user.tenantId]
    );
    if(!result.rowCount)throw new NotFoundException('Your employee account was not found.');
    return {success:true};
  }
  @Patch('me/password') async changeOwnPassword(@Req() req:UserRequest,@Body() body:ChangePasswordDto){
    if(body.currentPassword===body.newPassword)throw new BadRequestException('Choose a new password different from your current password.');
    const result=await this.db.query<{password_hash:string}>(
      'SELECT password_hash FROM users WHERE id=$1 AND tenant_id=$2 AND active=true',[req.user.id,req.user.tenantId]);
    const account=result.rows[0];
    if(!account)throw new NotFoundException('Your employee account was not found.');
    if(!(await bcrypt.compare(body.currentPassword,account.password_hash)))throw new BadRequestException('Current password is incorrect.');
    const passwordHash=await bcrypt.hash(body.newPassword,12);
    await this.db.query('UPDATE users SET password_hash=$3 WHERE id=$1 AND tenant_id=$2',[req.user.id,req.user.tenantId,passwordHash]);
    return {success:true};
  }
  @Patch(':id/password') async resetPassword(@Req() req:UserRequest,@Param('id') id:string,@Body() body:TemporaryPasswordDto){
    this.require(req.user,'team.manage');
    if(id===req.user.id)throw new BadRequestException('Use the change-password form to update your own password.');
    const passwordHash=await bcrypt.hash(body.password,12);
    const result=await this.db.query(
      'UPDATE users SET password_hash=$3 WHERE id=$1 AND tenant_id=$2 RETURNING id',
      [id,req.user.tenantId,passwordHash]
    );
    if(!result.rowCount)throw new NotFoundException('Employee account was not found.');
    return {success:true};
  }
  @Patch(':id') async update(@Req() req:UserRequest,@Param('id') id:string,@Body() body:UpdateEmployeeDto){
    this.require(req.user,'team.manage');
    if(body.fullName===undefined&&body.email===undefined&&body.active===undefined&&body.roleId===undefined)throw new BadRequestException('Provide employee profile details, account status, or role to update.');
    if(body.fullName!==undefined&&!body.fullName.trim())throw new BadRequestException('Enter the employee name.');
    return this.db.transaction(async client=>{
      await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE',[req.user.tenantId]);
      const selected=await client.query<{id:string;role_id:string;system_role:string|null;active:boolean}>(
        `SELECT u.id,u.role_id,r.system_role,u.active FROM users u
         JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
         WHERE u.id=$1 AND u.tenant_id=$2 FOR UPDATE OF u`,[id,req.user.tenantId]
      );
      const target=selected.rows[0];
      if(!target)throw new NotFoundException('Employee account was not found.');
      let nextRoleId=target.role_id;
      let nextSystemRole=target.system_role;
      let nextRoleName:string|undefined;
      if(body.roleId){
        const selectedRole=await client.query<{id:string;name:string;system_role:string|null}>(
          'SELECT id,name,system_role FROM roles WHERE id=$1 AND tenant_id=$2',[body.roleId,req.user.tenantId]);
        if(!selectedRole.rowCount) throw new BadRequestException('Select a role from your organization.');
        nextRoleId=selectedRole.rows[0].id;
        nextSystemRole=selectedRole.rows[0].system_role;
        nextRoleName=selectedRole.rows[0].name;
      }
      if(!nextRoleName){
        const currentRole=await client.query<{name:string}>('SELECT name FROM roles WHERE id=$1 AND tenant_id=$2',[nextRoleId,req.user.tenantId]);
        nextRoleName=currentRole.rows[0]?.name;
      }
      const nextActive=body.active??target.active;
      if(id===req.user.id&&(!nextActive||nextSystemRole!=='admin'))throw new BadRequestException('You cannot deactivate or remove Administrator access from your own account.');
      if(target.active&&target.system_role==='admin'&&(!nextActive||nextSystemRole!=='admin')){
        const admins=await client.query<{count:string}>(
          `SELECT count(*)::text AS count FROM users u JOIN roles r ON r.id=u.role_id
           WHERE u.tenant_id=$1 AND u.active=true AND r.system_role='admin'`,
          [req.user.tenantId]
        );
        if(Number(admins.rows[0]?.count??0)<=1)throw new BadRequestException('The organization must retain at least one active Administrator.');
      }
      let result;
      try{
        result=await client.query(
          `UPDATE users SET full_name=COALESCE($3,full_name),email=COALESCE($4,email),
             active=$5,role=$6,role_id=$7
           WHERE id=$1 AND tenant_id=$2
           RETURNING id,full_name AS "fullName",email,role_id AS "roleId",active,created_at AS "createdAt"`,
          [id,req.user.tenantId,body.fullName?.trim()||null,body.email?.trim().toLowerCase()||null,nextActive,nextSystemRole??'employee',nextRoleId]
        );
      }catch(error){
        if((error as {code?:string}).code==='23505')throw new ConflictException('An employee with this email already exists.');
        throw error;
      }
      return {...result.rows[0],role:nextRoleName};
    });
  }
  private detectImageType(buffer:Buffer):string|null{
    if(buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return 'image/jpeg';
    if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'image/png';
    if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
    return null;
  }
}
