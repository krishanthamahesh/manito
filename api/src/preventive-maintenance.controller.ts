import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';

class CreateMaintenancePlanDto {
  @IsUUID() assetId!:string;
  @IsString() @MinLength(1) @MaxLength(160) title!:string;
  @IsString() @MinLength(1) @MaxLength(5000) description!:string;
  @IsInt() @Min(1) @Max(36500) intervalDays!:number;
  @IsInt() @Min(1) @Max(10000) maxCompletedRuns!:number;
  @IsDateString() nextDueDate!:string;
}

class UpdateMaintenancePlanDto {
  @IsOptional() @IsBoolean() active?:boolean;
  @IsOptional() @IsUUID() assetId?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) title?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) description?:string;
  @IsOptional() @IsInt() @Min(1) @Max(36500) intervalDays?:number;
  @IsOptional() @IsInt() @Min(1) @Max(10000) maxCompletedRuns?:number;
  @IsOptional() @IsDateString() nextDueDate?:string;
}

interface UserRequest extends Request { user:AuthUser; }

@Controller('preventive-maintenance')
@UseGuards(AuthGuard)
export class PreventiveMaintenanceController {
  constructor(private readonly db:DatabaseService){}

  @Get()
  async list(@Req() req:UserRequest){
    requirePermission(req.user,'maintenance.read');
    const result=await this.db.query(`SELECT p.id,p.asset_id AS "assetId",p.title,p.description,p.interval_days AS "intervalDays",
        to_char(p.next_due_date,'YYYY-MM-DD') AS "nextDueDate",p.max_completed_runs AS "maxCompletedRuns",
        completed.completed_count AS "completedCount",(completed.completed_count>=p.max_completed_runs) AS expired,
        p.active,(p.next_due_date<=(now() AT TIME ZONE t.time_zone)::date) AS due,
        a.name AS "assetName",a.make AS "assetMake",a.model AS "assetModel",a.serial_number AS "assetSerialNumber",
        a.location,c.id AS "customerId",c.full_name AS "customerName",
        last_run."jobNumber",last_run."lastRunDate"
      FROM preventive_maintenance_plans p
      JOIN tenants t ON t.id=p.tenant_id
      JOIN assets a ON a.id=p.asset_id AND a.tenant_id=p.tenant_id
      JOIN customers c ON c.id=a.customer_id AND c.tenant_id=a.tenant_id
      LEFT JOIN LATERAL (
        SELECT j.job_number AS "jobNumber",to_char(r.due_date,'YYYY-MM-DD') AS "lastRunDate"
        FROM preventive_maintenance_runs r JOIN jobs j ON j.id=r.job_id AND j.tenant_id=r.tenant_id
        WHERE r.plan_id=p.id AND r.tenant_id=p.tenant_id
        ORDER BY r.due_date DESC LIMIT 1
      ) last_run ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS completed_count
        FROM preventive_maintenance_runs r
        WHERE r.plan_id=p.id AND r.tenant_id=p.tenant_id AND r.completed_at IS NOT NULL
      ) completed ON true
      WHERE p.tenant_id=$1
      ORDER BY p.active DESC,p.next_due_date,lower(p.title)
      LIMIT 500`,[req.user.tenantId]);
    return result.rows;
  }

  @Post()
  async create(@Req() req:UserRequest,@Body() body:CreateMaintenancePlanDto){
    requirePermission(req.user,'maintenance.write');
    const title=body.title.trim();
    const description=body.description.trim();
    if(!title||!description) throw new BadRequestException('Enter a plan name and maintenance instructions.');
    const asset=await this.db.query('SELECT id FROM assets WHERE id=$1 AND tenant_id=$2',[body.assetId,req.user.tenantId]);
    if(!asset.rowCount) throw new BadRequestException('Select equipment from your organization.');
    const result=await this.db.query(`INSERT INTO preventive_maintenance_plans(tenant_id,asset_id,created_by,title,description,interval_days,max_completed_runs,next_due_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::date)
      RETURNING id,asset_id AS "assetId",title,description,interval_days AS "intervalDays",max_completed_runs AS "maxCompletedRuns",to_char(next_due_date,'YYYY-MM-DD') AS "nextDueDate",active`,
    [req.user.tenantId,body.assetId,req.user.id,title,description,body.intervalDays,body.maxCompletedRuns,body.nextDueDate]);
    return result.rows[0];
  }

  @Patch(':id')
  async update(@Req() req:UserRequest,@Param('id') id:string,@Body() body:UpdateMaintenancePlanDto){
    requirePermission(req.user,'maintenance.write');
    if(Object.keys(body).length===0) throw new BadRequestException('Provide at least one maintenance plan field to update.');
    return this.db.transaction(async client=>{
      const plan=await client.query<{asset_id:string;title:string;description:string;interval_days:number;max_completed_runs:number;next_due_date:string;active:boolean;completed_count:number}>(
        `SELECT p.asset_id,p.title,p.description,p.interval_days,p.max_completed_runs,
          to_char(p.next_due_date,'YYYY-MM-DD') AS next_due_date,p.active,
          (SELECT count(*)::int FROM preventive_maintenance_runs r
            WHERE r.plan_id=p.id AND r.tenant_id=p.tenant_id AND r.completed_at IS NOT NULL) AS completed_count
         FROM preventive_maintenance_plans p WHERE p.id=$1 AND p.tenant_id=$2 FOR UPDATE`,
        [id,req.user.tenantId]);
      if(!plan.rowCount) throw new BadRequestException('Preventive maintenance plan was not found.');
      const current=plan.rows[0];
      const active=body.active??current.active;
      const maxCompletedRuns=body.maxCompletedRuns??current.max_completed_runs;
      if(active&&current.completed_count>=maxCompletedRuns) throw new BadRequestException('This preventive maintenance plan has reached its completed-work-order limit.');
      if(maxCompletedRuns<current.completed_count) throw new BadRequestException(`The completed-work-order limit cannot be lower than the ${current.completed_count} already completed.`);
      if(body.assetId){
        const asset=await client.query('SELECT id FROM assets WHERE id=$1 AND tenant_id=$2',[body.assetId,req.user.tenantId]);
        if(!asset.rowCount) throw new BadRequestException('Select equipment from your organization.');
      }
      const title=body.title?.trim()??current.title;
      const description=body.description?.trim()??current.description;
      if(!title||!description) throw new BadRequestException('Enter a plan name and maintenance instructions.');
      const result=await client.query(`UPDATE preventive_maintenance_plans
        SET active=$3,asset_id=$4,title=$5,description=$6,interval_days=$7,max_completed_runs=$8,next_due_date=$9::date,updated_at=now()
        WHERE id=$1 AND tenant_id=$2
        RETURNING id,active,asset_id AS "assetId",title,description,interval_days AS "intervalDays",
          max_completed_runs AS "maxCompletedRuns",to_char(next_due_date,'YYYY-MM-DD') AS "nextDueDate"`,
      [id,req.user.tenantId,active,body.assetId??current.asset_id,title,description,
        body.intervalDays??current.interval_days,maxCompletedRuns,body.nextDueDate??current.next_due_date]);
      return result.rows[0];
    });
  }

  @Post(':id/generate')
  async generateWorkOrder(@Req() req:UserRequest,@Param('id') id:string){
    requirePermission(req.user,'maintenance.write');
    return this.db.transaction(async client=>{
      const plan=await client.query<{asset_id:string;title:string;description:string;interval_days:number;max_completed_runs:number;completed_count:number;next_due_date:string;active:boolean;due:boolean}>(
        `SELECT p.asset_id,p.title,p.description,p.interval_days,p.max_completed_runs,
          (SELECT count(*)::int FROM preventive_maintenance_runs r WHERE r.plan_id=p.id AND r.tenant_id=p.tenant_id AND r.completed_at IS NOT NULL) AS completed_count,
          to_char(p.next_due_date,'YYYY-MM-DD') AS next_due_date,p.active,
          (p.next_due_date<=(now() AT TIME ZONE t.time_zone)::date) AS due
         FROM preventive_maintenance_plans p JOIN tenants t ON t.id=p.tenant_id
         WHERE p.id=$1 AND p.tenant_id=$2 FOR UPDATE OF p`,[id,req.user.tenantId]);
      const current=plan.rows[0];
      if(!current) throw new BadRequestException('Preventive maintenance plan was not found.');
      if(current.completed_count>=current.max_completed_runs) throw new BadRequestException('This preventive maintenance plan has reached its completed-work-order limit.');
      if(!current.active) throw new BadRequestException('Activate this maintenance plan before generating work.');
      if(!current.due) throw new BadRequestException('This maintenance is not due yet.');
      const run=await client.query(`INSERT INTO jobs(tenant_id,customer_id,asset_id,created_by,title,description,contact_channel,equipment_description,location,reported_urgency,scheduled_date,status)
        SELECT $1,a.customer_id,a.id,$3,$4,$5,'preventive',concat_ws(' ',NULLIF(a.make,''),NULLIF(a.model,'')),
          a.location,'normal',p.next_due_date,'accepted'
        FROM assets a JOIN preventive_maintenance_plans p ON p.asset_id=a.id AND p.tenant_id=a.tenant_id
        WHERE p.id=$2 AND p.tenant_id=$1
        RETURNING id,job_number AS "jobNumber",title,status,scheduled_date AS "scheduledDate"`,
      [req.user.tenantId,id,req.user.id,`Preventive maintenance: ${current.title}`,current.description]);
      const job=run.rows[0];
      if(!job) throw new BadRequestException('The equipment for this maintenance plan was not found.');
      await client.query(`INSERT INTO preventive_maintenance_runs(tenant_id,plan_id,due_date,job_id,actor_id)
        VALUES($1,$2,$3::date,$4,$5)`,[req.user.tenantId,id,current.next_due_date,job.id,req.user.id]);
      await client.query(`INSERT INTO job_events(tenant_id,job_id,actor_id,event_type,new_value,details)
        VALUES($1,$2,$3,'created','accepted',$4)`,[req.user.tenantId,job.id,req.user.id,`Generated from preventive maintenance plan "${current.title}" for ${current.next_due_date}.`]);
      await client.query(`UPDATE preventive_maintenance_plans
        SET next_due_date=next_due_date+interval_days,updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,[id,req.user.tenantId]);
      return {...job,sourcePlanId:id,dueDate:current.next_due_date};
    });
  }
}
