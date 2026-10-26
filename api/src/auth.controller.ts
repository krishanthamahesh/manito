import { BadRequestException, Body,Controller,Get,Post,Query,Req,UseGuards } from '@nestjs/common';
import { IsEmail,IsOptional,IsString,MaxLength,MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthService,AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
class LoginDto { @IsEmail() email!:string; @IsString() @MinLength(1) password!:string; }
class BrandingResponseDto { @IsOptional() @IsEmail() @MaxLength(254) email?:string; }
interface UserRequest extends Request { user:AuthUser; }
@Controller('auth')
export class AuthController {
  constructor(private readonly auth:AuthService,private readonly db:DatabaseService){}
  @Post('login') login(@Body() body:LoginDto){return this.auth.login(body.email,body.password);}
  @Get('branding')
  async branding(@Query() query:BrandingResponseDto){
    const email=query.email?.trim().toLowerCase();
    const result=await this.db.query<{logo_base64:string|null;logo_content_type:string|null;shop_name:string;color_theme:'green'|'blue'|'violet'|'amber'}>(
      email
        ?`SELECT encode(t.logo,'base64') AS logo_base64,t.logo_content_type,t.name AS shop_name,t.color_theme
          FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE lower(u.email)=lower($1) AND u.active=true`
        :`SELECT encode(logo,'base64') AS logo_base64,logo_content_type,name AS shop_name,color_theme
          FROM tenants ORDER BY created_at,id LIMIT 1`,
      email?[email]:[]
    );
    const branding=result.rows[0];
    return {
      shopName:branding?.shop_name??null,
      colorTheme:branding?.color_theme??'green',
      logoDataUrl:branding?.logo_base64&&branding.logo_content_type
        ?`data:${branding.logo_content_type};base64,${branding.logo_base64}`
        :null
    };
  }
  @Get('me') @UseGuards(AuthGuard) me(@Req() req:UserRequest){return req.user;}
}
