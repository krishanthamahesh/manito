import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { DatabaseService } from './database.service';
export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
  roleId: string;
  roleName: string;
  systemRole: string | null;
  permissions: string[];
}
@Injectable()
export class AuthService {
  constructor(private readonly db:DatabaseService){}
  async login(emailInput:string,password:string){
    const email=emailInput.trim().toLowerCase();
    const result=await this.db.query<{id:string;tenant_id:string;email:string;full_name:string;role_key:string;role_id:string;role_name:string;system_role:string|null;permissions:string[];password_hash:string;active:boolean}>(
      `SELECT u.id,u.tenant_id,u.email,u.full_name,u.password_hash,u.active,r.role_key,r.id AS role_id,
        r.name AS role_name,r.system_role,r.permissions
       FROM users u JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
       WHERE u.email=$1`,[email]);
    const row=result.rows[0];
    if(!row||!row.active||!(await bcrypt.compare(password,row.password_hash))) throw new UnauthorizedException('Email or password is incorrect.');
    const secret=process.env.JWT_SECRET; if(!secret) throw new Error('JWT_SECRET is not configured.');
    const user:AuthUser={
      id:row.id,tenantId:row.tenant_id,email:row.email,fullName:row.full_name,role:row.role_key,
      roleId:row.role_id,roleName:row.role_name,systemRole:row.system_role,permissions:row.permissions
    };
    const accessToken=sign({sub:user.id},secret,{expiresIn:43200});
    return {accessToken,user};
  }
}
