import { BadRequestException, Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';

class NotificationReadDto {
  @IsBoolean() read!:boolean;
}

interface UserRequest extends Request { user:AuthUser; }

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async list(@Req() req:UserRequest){
    requirePermission(req.user,'notifications.read');
    await this.db.query(`INSERT INTO notifications(tenant_id,user_id,event_key,notification_type,title,message,job_id)
      SELECT source.tenant_id,u.id,source.event_key,source.notification_type,source.title,source.message,source.job_id
      FROM (
        SELECT j.tenant_id,j.assigned_to AS user_id,
          'overdue-work:'||j.id||':'||to_char(j.scheduled_date,'YYYY-MM-DD') AS event_key,
          'overdue_work' AS notification_type,'Work order is overdue' AS title,
          format('Work order #%s · %s was scheduled for %s.',lpad(j.job_number::text,5,'0'),j.title,to_char(j.scheduled_date,'Mon FMDD, YYYY')) AS message,
          j.id AS job_id
        FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        WHERE j.tenant_id=$1 AND j.assigned_to IS NOT NULL AND j.scheduled_date<(now() AT TIME ZONE t.time_zone)::date
          AND j.status NOT IN ('completed','cancelled')
        UNION ALL
        SELECT j.tenant_id,u.id,
          'overdue-work:'||j.id||':'||to_char(j.scheduled_date,'YYYY-MM-DD'),
          'overdue_work','Work order is overdue',
          format('Work order #%s · %s was scheduled for %s.',lpad(j.job_number::text,5,'0'),j.title,to_char(j.scheduled_date,'Mon FMDD, YYYY')),
          j.id
        FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        JOIN users u ON u.tenant_id=j.tenant_id AND u.active=true
        JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id AND r.permissions @> ARRAY['reports.read']::text[]
        WHERE j.tenant_id=$1 AND j.scheduled_date<(now() AT TIME ZONE t.time_zone)::date AND j.status NOT IN ('completed','cancelled')
        UNION ALL
        SELECT p.tenant_id,u.id,
          'maintenance-due:'||p.id||':'||to_char(p.next_due_date,'YYYY-MM-DD'),
          'maintenance_due','Preventive maintenance is due',
          format('%s · %s is due for %s.',p.title,a.name,to_char(p.next_due_date,'Mon FMDD, YYYY')),
          NULL::uuid
        FROM preventive_maintenance_plans p JOIN tenants t ON t.id=p.tenant_id
        JOIN assets a ON a.id=p.asset_id AND a.tenant_id=p.tenant_id
        JOIN users u ON u.tenant_id=p.tenant_id AND u.active=true
        JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id AND r.permissions @> ARRAY['maintenance.read']::text[]
        WHERE p.tenant_id=$1 AND p.active=true AND p.next_due_date<=(now() AT TIME ZONE t.time_zone)::date
      ) source JOIN users u ON u.id=source.user_id AND u.tenant_id=source.tenant_id AND u.active=true
      ON CONFLICT(tenant_id,user_id,event_key) DO NOTHING`,[req.user.tenantId]);
    const result=await this.db.query(`SELECT id,notification_type AS "notificationType",title,message,job_id AS "jobId",
        is_read AS "isRead",created_at AS "createdAt"
      FROM notifications WHERE tenant_id=$1 AND user_id=$2
      ORDER BY is_read,created_at DESC LIMIT 100`,[req.user.tenantId,req.user.id]);
    const unread=await this.db.query<{count:number}>('SELECT count(*)::int AS count FROM notifications WHERE tenant_id=$1 AND user_id=$2 AND is_read=false',[req.user.tenantId,req.user.id]);
    return {items:result.rows,unreadCount:unread.rows[0]?.count??0};
  }

  @Patch(':id')
  async update(@Req() req:UserRequest,@Param('id') id:string,@Body() body:NotificationReadDto){
    requirePermission(req.user,'notifications.read');
    const result=await this.db.query(`UPDATE notifications SET is_read=$3,read_at=CASE WHEN $3 THEN now() ELSE NULL END
      WHERE id=$1 AND tenant_id=$2 AND user_id=$4
      RETURNING id,is_read AS "isRead"`,[id,req.user.tenantId,body.read,req.user.id]);
    if(!result.rowCount) throw new BadRequestException('Notification was not found.');
    return result.rows[0];
  }

  @Patch()
  async markAllRead(@Req() req:UserRequest){
    requirePermission(req.user,'notifications.read');
    const result=await this.db.query(`UPDATE notifications SET is_read=true,read_at=now()
      WHERE tenant_id=$1 AND user_id=$2 AND is_read=false`,[req.user.tenantId,req.user.id]);
    return {updated:result.rowCount??0};
  }
}
