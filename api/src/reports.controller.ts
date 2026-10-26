import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';

interface UserRequest extends Request { user:AuthUser; }

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly db:DatabaseService){}

  @Get('dashboard')
  async dashboard(@Req() req:UserRequest,@Query('from') from?:string,@Query('to') to?:string,@Query('status') status='all'){
    requirePermission(req.user,'reports.read');
    const datePattern=/^\d{4}-\d{2}-\d{2}$/;
    const isDate=(value:string)=>{if(!datePattern.test(value))return false;const date=new Date(`${value}T00:00:00.000Z`);return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;};
    const statuses=['all','new','under_review','awaiting_customer','accepted','assigned','in_progress','on_hold','completed','cancelled'];
    if(!from||!to||!isDate(from)||!isDate(to)||from>to) throw new BadRequestException('Provide a valid report date range.');
    if((new Date(`${to}T00:00:00Z`).getTime()-new Date(`${from}T00:00:00Z`).getTime())/86400000>3660) throw new BadRequestException('Report date ranges cannot exceed 10 years.');
    if(!statuses.includes(status)) throw new BadRequestException('Select a valid job status.');
    const jobValues:unknown[]=[req.user.tenantId,from,to];
    const jobFilter=status==='all'?'':` AND j.status=$4`;
    const createdRange="j.created_at >= ($2::date::timestamp AT TIME ZONE t.time_zone) AND j.created_at < (($3::date+1)::timestamp AT TIME ZONE t.time_zone)";
    if(status!=='all') jobValues.push(status);
    const [summary,statusesByCount,priorities,completionTrend,jobs,labor]=await Promise.all([
      this.db.query(`SELECT count(*)::int AS "jobsCreated",
          count(*) FILTER(WHERE j.status NOT IN ('completed','cancelled'))::int AS "openWork",
          count(*) FILTER(WHERE j.status='completed')::int AS "completedWork",
          count(*) FILTER(WHERE j.status='in_progress')::int AS "inProgress"
        FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        WHERE j.tenant_id=$1 AND ${createdRange}${jobFilter}`,jobValues),
      this.db.query(`SELECT j.status,count(*)::int AS count FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        WHERE j.tenant_id=$1 AND ${createdRange}${jobFilter}
        GROUP BY j.status ORDER BY count DESC,j.status`,jobValues),
      this.db.query(`SELECT j.priority,count(*)::int AS count FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        WHERE j.tenant_id=$1 AND ${createdRange}${jobFilter}
        GROUP BY j.priority ORDER BY count DESC,j.priority`,jobValues),
      this.db.query(`SELECT to_char(date_trunc('day',e.created_at AT TIME ZONE t.time_zone),'YYYY-MM-DD') AS date,count(*)::int AS count
        FROM job_events e JOIN jobs j ON j.id=e.job_id AND j.tenant_id=e.tenant_id
        JOIN tenants t ON t.id=e.tenant_id
        WHERE e.tenant_id=$1 AND e.event_type='status_changed' AND e.new_value='completed'
          AND e.created_at >= ($2::date::timestamp AT TIME ZONE t.time_zone)
          AND e.created_at < (($3::date+1)::timestamp AT TIME ZONE t.time_zone)${jobFilter}
        GROUP BY date_trunc('day',e.created_at AT TIME ZONE t.time_zone) ORDER BY date`,jobValues),
      this.db.query(`SELECT j.id,j.job_number AS "jobNumber",j.title,c.full_name AS "customerName",j.contact_channel AS "contactChannel",
          j.status,j.priority,j.location,assigned.full_name AS "assignedName",contractor.name AS "contractorName",
          to_char(j.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",to_char(j.created_at,'YYYY-MM-DD') AS "createdDate",
          (j.scheduled_date<(now() AT TIME ZONE t.time_zone)::date AND j.status NOT IN ('completed','cancelled')) AS overdue
        FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        JOIN customers c ON c.id=j.customer_id AND c.tenant_id=j.tenant_id
        LEFT JOIN users assigned ON assigned.id=j.assigned_to AND assigned.tenant_id=j.tenant_id
        LEFT JOIN contractors contractor ON contractor.id=j.contractor_id AND contractor.tenant_id=j.tenant_id
        WHERE j.tenant_id=$1 AND ${createdRange}${jobFilter}
        ORDER BY j.created_at DESC,j.job_number DESC LIMIT 1000`,jobValues),
      this.db.query(`SELECT COALESCE(sum(l.minutes),0)::int AS "laborMinutes"
        FROM job_labor_entries l JOIN jobs j ON j.id=l.job_id AND j.tenant_id=l.tenant_id
        WHERE l.tenant_id=$1 AND l.worked_on BETWEEN $2::date AND $3::date${jobFilter}`,jobValues)
    ]);
    const [overdue,upcoming,maintenanceDue,lowStock]=await Promise.all([
      this.db.query(`SELECT count(*)::int AS count FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        WHERE j.tenant_id=$1 AND j.scheduled_date<(now() AT TIME ZONE t.time_zone)::date AND j.status NOT IN ('completed','cancelled')`,[req.user.tenantId]),
      this.db.query(`SELECT count(*)::int AS count FROM jobs j JOIN tenants t ON t.id=j.tenant_id
        WHERE j.tenant_id=$1 AND j.scheduled_date>=(now() AT TIME ZONE t.time_zone)::date
          AND j.scheduled_date<(now() AT TIME ZONE t.time_zone)::date+30 AND j.status NOT IN ('completed','cancelled')`,[req.user.tenantId]),
      this.db.query(`SELECT count(*)::int AS count FROM preventive_maintenance_plans WHERE tenant_id=$1 AND active=true AND next_due_date<= $2::date`,[req.user.tenantId,to]),
      this.db.query(`SELECT count(*)::int AS count FROM inventory_items WHERE tenant_id=$1 AND active=true AND stock_quantity<=reorder_level`,[req.user.tenantId])
    ]);
    return {
      from,to,status,
      metrics:{...summary.rows[0],overdueWorkOrders:overdue.rows[0].count,upcomingWorkOrders:upcoming.rows[0].count,maintenanceDue:maintenanceDue.rows[0].count,lowStockItems:lowStock.rows[0].count,laborMinutes:labor.rows[0].laborMinutes},
      statusBreakdown:statusesByCount.rows,
      priorityBreakdown:priorities.rows,
      completionTrend:completionTrend.rows,
      jobs:jobs.rows,
      jobsTruncated:jobs.rowCount===1000
    };
  }
}
