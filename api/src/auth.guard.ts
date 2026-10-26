import { CanActivate,ExecutionContext,Injectable,UnauthorizedException } from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly db:DatabaseService){}
  async canActivate(context:ExecutionContext):Promise<boolean> {
    const request=context.switchToHttp().getRequest<{headers:{authorization?:string};user?:AuthUser}>();
    const header=request.headers.authorization; const token=header?.startsWith('Bearer ')?header.slice(7):undefined; const secret=process.env.JWT_SECRET;
    if(!token||!secret) throw new UnauthorizedException('Sign in to continue.');
    let payload;
    try {
      payload=verify(token,secret);
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    if(typeof payload==='string'||typeof payload.sub!=='string') throw new UnauthorizedException('Invalid session.');
    const result=await this.db.query<{id:string;tenant_id:string;email:string;full_name:string;role_key:string;role_id:string;role_name:string;system_role:string|null;permissions:string[];active:boolean}>(
      `SELECT u.id,u.tenant_id,u.email,u.full_name,u.active,r.role_key,r.id AS role_id,
        r.name AS role_name,r.system_role,r.permissions
       FROM users u JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
       WHERE u.id=$1`,
      [payload.sub]
    );
    const user=result.rows[0];
    if(!user||!user.active) throw new UnauthorizedException('This employee account is inactive.');
    request.user={
      id:user.id,tenantId:user.tenant_id,email:user.email,fullName:user.full_name,role:user.role_key,
      roleId:user.role_id,roleName:user.role_name,systemRole:user.system_role,permissions:user.permissions
    };
    return true;
  }
}
