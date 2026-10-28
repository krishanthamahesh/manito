import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Patch, Post, Req, UploadedFile, UseFilters, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requireAdministrator, requirePermission } from './authorization';
import { ImageUploadExceptionFilter } from './image-upload.filter';
const MAX_ORGANIZATION_LOGO_SIZE=2*1024*1024;
const ORGANIZATION_COLOR_THEMES=['green','blue','violet','amber'] as const;
type OrganizationColorTheme=typeof ORGANIZATION_COLOR_THEMES[number];
interface UploadedOrganizationLogo{buffer:Buffer;mimetype:string;}

class UpdateOrganizationSettingsDto {
  @IsString() @MinLength(1) @MaxLength(120) shopName!:string;
  @IsOptional() @IsString() @MaxLength(500) address?:string;
  @IsOptional() @IsString() @MaxLength(40) officeContactPhone?:string;
  @IsOptional() @IsString() @MaxLength(40) technicalContactPhone?:string;
  @IsOptional() @IsEmail() @MaxLength(254) contactEmail?:string;
  @IsString() @MinLength(1) @MaxLength(100) timeZone!:string;
  @IsBoolean() phoneIntakeEnabled!:boolean;
  @IsBoolean() walkInIntakeEnabled!:boolean;
  @IsOptional() @IsIn(ORGANIZATION_COLOR_THEMES) colorTheme?:OrganizationColorTheme;
}

interface UserRequest extends Request { user:AuthUser; }

@Controller('organization-settings')
@UseGuards(AuthGuard)
export class OrganizationSettingsController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async get(@Req() req:UserRequest){
    requirePermission(req.user,'settings.read');
    const result=await this.db.query<{shopName:string;address:string|null;officeContactPhone:string|null;technicalContactPhone:string|null;contactEmail:string|null;timeZone:string;
      phoneIntakeEnabled:boolean;walkInIntakeEnabled:boolean;colorTheme:OrganizationColorTheme;logoBase64:string|null;logoContentType:string|null}>
      (`SELECT name AS "shopName",address,contact_phone AS "officeContactPhone",
      technical_contact_phone AS "technicalContactPhone",contact_email AS "contactEmail",
      time_zone AS "timeZone",phone_intake_enabled AS "phoneIntakeEnabled",walk_in_intake_enabled AS "walkInIntakeEnabled",
      color_theme AS "colorTheme",
      encode(logo,'base64') AS "logoBase64",logo_content_type AS "logoContentType"
      FROM tenants WHERE id=$1`,[req.user.tenantId]);
    if(!result.rowCount) throw new BadRequestException('Organization was not found.');
    const {logoBase64,logoContentType,...settings}=result.rows[0];
    return {...settings,logoDataUrl:logoBase64&&logoContentType?`data:${logoContentType};base64,${logoBase64}`:null};
  }

  @Get('theme')
  async getTheme(@Req() req:UserRequest){
    const result=await this.db.query<{colorTheme:OrganizationColorTheme}>(
      'SELECT color_theme AS "colorTheme" FROM tenants WHERE id=$1',[req.user.tenantId]
    );
    if(!result.rowCount) throw new BadRequestException('Organization was not found.');
    return result.rows[0];
  }

  @Patch()
  async update(@Req() req:UserRequest,@Body() body:UpdateOrganizationSettingsDto){
    requireAdministrator(req.user);
    const shopName=body.shopName.trim();
    const address=body.address?.trim()||null;
    const timeZone=body.timeZone.trim();
    if(!shopName) throw new BadRequestException('Enter an organization name.');
    if(!body.phoneIntakeEnabled&&!body.walkInIntakeEnabled) throw new BadRequestException('Enable at least one job intake channel.');
    try {
      new Intl.DateTimeFormat('en-US',{timeZone});
    } catch(error) {
      if(error instanceof RangeError) throw new BadRequestException('Enter a valid IANA timezone, such as Asia/Colombo or UTC.');
      throw error;
    }
    try {
      const result=await this.db.query<{shopName:string;address:string|null;officeContactPhone:string|null;technicalContactPhone:string|null;contactEmail:string|null;timeZone:string;
        phoneIntakeEnabled:boolean;walkInIntakeEnabled:boolean;colorTheme:OrganizationColorTheme;
        logoBase64:string|null;logoContentType:string|null}>(`UPDATE tenants SET name=$2,address=$3,contact_phone=$4,
        technical_contact_phone=$5,contact_email=$6,time_zone=$7,phone_intake_enabled=$8,
        walk_in_intake_enabled=$9,color_theme=COALESCE($10,color_theme)
        WHERE id=$1
        RETURNING name AS "shopName",address,contact_phone AS "officeContactPhone",
          technical_contact_phone AS "technicalContactPhone",contact_email AS "contactEmail",
          time_zone AS "timeZone",phone_intake_enabled AS "phoneIntakeEnabled",walk_in_intake_enabled AS "walkInIntakeEnabled",
          color_theme AS "colorTheme",
          encode(logo,'base64') AS "logoBase64",logo_content_type AS "logoContentType"`,
      [req.user.tenantId,shopName,address,body.officeContactPhone?.trim()||null,
        body.technicalContactPhone?.trim()||null,body.contactEmail?.trim().toLowerCase()||null,timeZone,
        body.phoneIntakeEnabled,body.walkInIntakeEnabled,body.colorTheme||null]);
      if(!result.rowCount) throw new BadRequestException('Organization was not found.');
      const {logoBase64,logoContentType,...settings}=result.rows[0];
      return {...settings,logoDataUrl:logoBase64&&logoContentType?`data:${logoContentType};base64,${logoBase64}`:null};
    } catch(error) {
      if(typeof error==='object'&&error!==null&&'code' in error&&error.code==='23505') throw new ConflictException('An organization with this name already exists.');
      throw error;
    }
  }

  @Post('logo')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:MAX_ORGANIZATION_LOGO_SIZE,files:1,fields:3,parts:5}}))
  @UseFilters(ImageUploadExceptionFilter)
  async uploadLogo(@Req() req:UserRequest,@UploadedFile() file?:UploadedOrganizationLogo){
    requireAdministrator(req.user);
    if(!file)throw new BadRequestException('Choose an organization logo to upload.');
    const contentType=this.detectImageType(file.buffer);
    if(!contentType||contentType!==file.mimetype)throw new BadRequestException('Use a genuine JPEG, PNG, or WebP image.');
    const result=await this.db.query(
      'UPDATE tenants SET logo=$2,logo_content_type=$3 WHERE id=$1 RETURNING id',
      [req.user.tenantId,file.buffer,contentType]
    );
    if(!result.rowCount)throw new BadRequestException('Organization was not found.');
    return {success:true};
  }

  @Delete('logo')
  async removeLogo(@Req() req:UserRequest){
    requireAdministrator(req.user);
    const result=await this.db.query(
      'UPDATE tenants SET logo=NULL,logo_content_type=NULL WHERE id=$1 RETURNING id',[req.user.tenantId]
    );
    if(!result.rowCount)throw new BadRequestException('Organization was not found.');
    return {success:true};
  }

  private detectImageType(buffer:Buffer):string|null{
    if(buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff)return 'image/jpeg';
    if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return 'image/png';
    if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
    return null;
  }
}
