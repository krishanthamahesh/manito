import { BadRequestException,Body,Controller,Get,Param,Patch,Post,Query,Req,UseGuards } from '@nestjs/common';
import { IsDateString,IsIn,IsInt,IsNumber,IsOptional,IsString,IsUUID,Max,MaxLength,Min,MinLength,IsPositive } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';
import { pageResult, parsePagination } from './pagination';
class CreateJobDto {
  @IsUUID() customerId!:string;
  @IsOptional() @IsUUID() assetId?:string;
  @IsOptional() @IsUUID() organizationLocationId?:string;
  @IsString() @MinLength(1) @MaxLength(160) title!:string;
  @IsString() @MinLength(1) @MaxLength(5000) description!:string;
  @IsIn(['phone','walk_in']) contactChannel!: 'phone'|'walk_in';
  @IsOptional() @IsString() @MaxLength(200) equipmentDescription?:string;
  @IsString() @MinLength(1) @MaxLength(700) location!:string;
  @IsIn(['low','normal','urgent']) reportedUrgency!:string;
  @IsOptional() @IsDateString() preferredDate?:string;
}
class UpdateJobDto {
  @IsOptional() @IsIn(['new','under_review','awaiting_customer','accepted','assigned','in_progress','on_hold','completed','cancelled']) status?:string;
  @IsOptional() @IsIn(['low','normal','high','urgent']) priority?:string;
  @IsOptional() @IsUUID() assignedTo?:string;
  @IsOptional() @IsUUID() contractorId?:string|null;
  @IsOptional() @IsDateString() preferredDate?:string;
  @IsOptional() @IsDateString() scheduledDate?:string;
  @IsOptional() @IsString() @MaxLength(5000) completionNotes?:string;
  @IsOptional() @IsString() @MaxLength(1000) statusReason?:string;
}
class LogLaborDto {
  @IsDateString() workedOn!:string;
  @IsInt() @Min(1) @Max(1440) minutes!:number;
  @IsString() @MinLength(1) @MaxLength(1000) description!:string;
}
class LogMaterialDto {
  @IsDateString() usedOn!:string;
  @IsOptional() @IsUUID() inventoryItemId?:string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) name?:string;
  @IsNumber({maxDecimalPlaces:3}) @IsPositive() @Max(999999999) quantity!:number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(30) unit?:string;
  @IsOptional() @IsString() @MaxLength(1000) notes?:string;
}
interface UserRequest extends Request { user:AuthUser; }
@Controller('jobs') @UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly db:DatabaseService){}
  @Get('summary') async summary(@Req() req:UserRequest){
    requirePermission(req.user,'jobs.read');
    const result=await this.db.query(`SELECT
      count(*) FILTER(WHERE status NOT IN ('completed','cancelled'))::int AS open,
      count(*) FILTER(WHERE priority='urgent' OR reported_urgency='urgent')::int AS urgent,
      count(*) FILTER(WHERE status='in_progress')::int AS progress,
      count(*) FILTER(WHERE status='completed')::int AS completed
      FROM jobs WHERE tenant_id=$1`,[req.user.tenantId]);
    return result.rows[0];
  }
  @Get() async list(@Req() req:UserRequest,@Query('status') status?:string,@Query('search') search?:string,@Query('page') page?:string,@Query('pageSize') pageSize?:string,@Query('priority') priority?:string){
    requirePermission(req.user,'jobs.read');
    const pagination=parsePagination(page,pageSize);
    const values:unknown[]=[req.user.tenantId]; const filters=['j.tenant_id=$1'];
    if(status&&status!=='all'){
      if(status==='open')filters.push(`j.status NOT IN ('completed','cancelled')`);
      else {values.push(status);filters.push(`j.status=$${values.length}`);}
    }
    if(priority&&priority!=='all'){
      if(!['low','normal','high','urgent'].includes(priority))throw new BadRequestException('Select a valid job priority.');
      values.push(priority);
      filters.push(priority==='urgent'
        ?`(j.priority=$${values.length} OR j.reported_urgency=$${values.length})`
        :`j.priority=$${values.length}`);
    }
    if(search?.trim()){values.push(`%${search.trim()}%`);filters.push(`(j.title ILIKE $${values.length} OR c.full_name ILIKE $${values.length} OR j.job_number::text ILIKE $${values.length} OR a.name ILIKE $${values.length} OR a.serial_number ILIKE $${values.length})`);}
    const from=`FROM jobs j JOIN customers c ON c.id=j.customer_id AND c.tenant_id=j.tenant_id LEFT JOIN assets a ON a.id=j.asset_id AND a.tenant_id=j.tenant_id`;
    const where=`WHERE ${filters.join(' AND ')}`;
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total ${from} ${where}`,values);
    const result=await this.db.query(`SELECT j.id,j.job_number AS "jobNumber",j.title,j.description,j.contact_channel AS "contactChannel",j.equipment_description AS "equipmentDescription",j.asset_id AS "assetId",a.name AS "assetName",a.make AS "assetMake",a.model AS "assetModel",a.serial_number AS "assetSerialNumber",j.organization_location_id AS "organizationLocationId",j.location,j.reported_urgency AS "reportedUrgency",j.priority,to_char(j.preferred_date,'YYYY-MM-DD') AS "preferredDate",to_char(j.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",j.status,j.status_reason AS "statusReason",j.completion_notes AS "completionNotes",j.created_at AS "createdAt",j.assigned_to AS "assignedTo",assigned.full_name AS "assignedName",j.contractor_id AS "contractorId",contractor.name AS "contractorName",c.id AS "customerId",c.full_name AS "customerName",c.phone AS "customerPhone",u.full_name AS "createdBy" ${from} JOIN users u ON u.id=j.created_by LEFT JOIN users assigned ON assigned.id=j.assigned_to AND assigned.tenant_id=j.tenant_id LEFT JOIN contractors contractor ON contractor.id=j.contractor_id AND contractor.tenant_id=j.tenant_id ${where} ORDER BY j.created_at DESC,j.id LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,pagination.pageSize,pagination.offset]);
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }
  @Get('schedule') async schedule(
    @Req() req:UserRequest,
    @Query('from') from?:string,
    @Query('to') to?:string,
    @Query('assignedTo') assignedTo?:string
  ){
    requirePermission(req.user,'schedule.read');
    const datePattern=/^\d{4}-\d{2}-\d{2}$/;
    const isDate=(value:string)=>{if(!datePattern.test(value))return false;const date=new Date(`${value}T00:00:00.000Z`);return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;};
    if(!from||!to||!isDate(from)||!isDate(to)||from>to) throw new BadRequestException('Provide a valid schedule date range.');
    const values:unknown[]=[req.user.tenantId,from,to];
    const filters=['j.tenant_id=$1','j.scheduled_date BETWEEN $2::date AND $3::date'];
    if(assignedTo==='unassigned') filters.push('j.assigned_to IS NULL');
    else if(assignedTo){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assignedTo)) throw new BadRequestException('Select a valid employee.');
      values.push(assignedTo);
      filters.push(`j.assigned_to=$${values.length}`);
    }
    const result=await this.db.query(`SELECT j.id,j.job_number AS "jobNumber",j.title,j.description,j.contact_channel AS "contactChannel",j.equipment_description AS "equipmentDescription",j.asset_id AS "assetId",a.name AS "assetName",a.make AS "assetMake",a.model AS "assetModel",a.serial_number AS "assetSerialNumber",j.organization_location_id AS "organizationLocationId",j.location,j.reported_urgency AS "reportedUrgency",j.priority,to_char(j.preferred_date,'YYYY-MM-DD') AS "preferredDate",to_char(j.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",j.status,j.status_reason AS "statusReason",j.completion_notes AS "completionNotes",j.created_at AS "createdAt",j.assigned_to AS "assignedTo",assigned.full_name AS "assignedName",j.contractor_id AS "contractorId",contractor.name AS "contractorName",c.id AS "customerId",c.full_name AS "customerName",c.phone AS "customerPhone",u.full_name AS "createdBy"
      FROM jobs j
      JOIN customers c ON c.id=j.customer_id AND c.tenant_id=j.tenant_id
      JOIN users u ON u.id=j.created_by
      LEFT JOIN users assigned ON assigned.id=j.assigned_to AND assigned.tenant_id=j.tenant_id
      LEFT JOIN contractors contractor ON contractor.id=j.contractor_id AND contractor.tenant_id=j.tenant_id
      LEFT JOIN assets a ON a.id=j.asset_id AND a.tenant_id=j.tenant_id
      WHERE ${filters.join(' AND ')}
      ORDER BY j.scheduled_date,CASE j.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,j.job_number
      LIMIT 500`,values);
    return result.rows;
  }
  @Post() async create(@Req() req:UserRequest,@Body() body:CreateJobDto){
    requirePermission(req.user,'jobs.create');
    const settings=await this.db.query<{phone_intake_enabled:boolean;walk_in_intake_enabled:boolean}>(
      'SELECT phone_intake_enabled,walk_in_intake_enabled FROM tenants WHERE id=$1',[req.user.tenantId]);
    const channelEnabled=body.contactChannel==='phone'?settings.rows[0]?.phone_intake_enabled:settings.rows[0]?.walk_in_intake_enabled;
    if(!channelEnabled) throw new BadRequestException('This job intake channel is disabled by your organization administrator.');
    const customer=await this.db.query('SELECT id FROM customers WHERE id=$1 AND tenant_id=$2',[body.customerId,req.user.tenantId]);
    if(!customer.rowCount) throw new BadRequestException('Select a customer from your organization.');
    if(body.assetId){
      const asset=await this.db.query('SELECT id FROM assets WHERE id=$1 AND customer_id=$2 AND tenant_id=$3',[body.assetId,body.customerId,req.user.tenantId]);
      if(!asset.rowCount) throw new BadRequestException('Select equipment belonging to this customer.');
    }
    let location=body.location.trim();
    let organizationLocationId:string|null=null;
    if(body.organizationLocationId){
      const selectedLocation=await this.db.query<{name:string;address:string}>(
        'SELECT name,address FROM organization_locations WHERE id=$1 AND tenant_id=$2 AND active=true',
        [body.organizationLocationId,req.user.tenantId]
      );
      if(!selectedLocation.rowCount) throw new BadRequestException('Select an active location belonging to your organization.');
      organizationLocationId=body.organizationLocationId;
      location=`${selectedLocation.rows[0].name} — ${selectedLocation.rows[0].address}`;
    }
    const result=await this.db.query(`INSERT INTO jobs(tenant_id,customer_id,asset_id,organization_location_id,created_by,title,description,contact_channel,equipment_description,location,reported_urgency,preferred_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,job_number AS "jobNumber",title,status,created_at AS "createdAt"`,[req.user.tenantId,body.customerId,body.assetId??null,organizationLocationId,req.user.id,body.title.trim(),body.description.trim(),body.contactChannel,body.equipmentDescription?.trim()||null,location,body.reportedUrgency,body.preferredDate||null]);
    const job=result.rows[0];
    await this.db.query(`INSERT INTO job_events(tenant_id,job_id,actor_id,event_type,new_value) VALUES($1,$2,$3,'created','new')`,[req.user.tenantId,job.id,req.user.id]);return job;
  }
  @Get(':id/logs') async logs(@Req() req:UserRequest,@Param('id') id:string){
    requirePermission(req.user,'worklogs.read');
    const job=await this.db.query('SELECT id FROM jobs WHERE id=$1 AND tenant_id=$2',[id,req.user.tenantId]);
    if(!job.rowCount) throw new BadRequestException('Work order was not found.');
    const [labor,materials,totals]=await Promise.all([
      this.db.query(`SELECT e.id,to_char(e.worked_on,'YYYY-MM-DD') AS "workedOn",e.minutes,e.description,e.created_at AS "createdAt",u.id AS "employeeId",u.full_name AS "employeeName"
        FROM job_labor_entries e JOIN users u ON u.id=e.employee_id AND u.tenant_id=e.tenant_id
        WHERE e.job_id=$1 AND e.tenant_id=$2 ORDER BY e.worked_on DESC,e.created_at DESC LIMIT 500`,[id,req.user.tenantId]),
      this.db.query(`SELECT e.id,to_char(e.used_on,'YYYY-MM-DD') AS "usedOn",e.inventory_item_id AS "inventoryItemId",e.name,e.quantity::float8 AS quantity,e.unit,e.notes,e.created_at AS "createdAt",u.id AS "employeeId",u.full_name AS "employeeName"
        FROM job_material_entries e JOIN users u ON u.id=e.employee_id AND u.tenant_id=e.tenant_id
        WHERE e.job_id=$1 AND e.tenant_id=$2 ORDER BY e.used_on DESC,e.created_at DESC LIMIT 500`,[id,req.user.tenantId]),
      this.db.query(`SELECT COALESCE(sum(minutes),0)::int AS "totalLaborMinutes",(SELECT count(*)::int FROM job_material_entries WHERE job_id=$1 AND tenant_id=$2) AS "materialEntryCount"
        FROM job_labor_entries WHERE job_id=$1 AND tenant_id=$2`,[id,req.user.tenantId])
    ]);
    return {labor:labor.rows,materials:materials.rows,summary:totals.rows[0]};
  }
  @Post(':id/labor') async addLabor(@Req() req:UserRequest,@Param('id') id:string,@Body() body:LogLaborDto){
    requirePermission(req.user,'worklogs.write');
    const description=body.description.trim();
    if(!description) throw new BadRequestException('Describe the work performed.');
    return this.db.transaction(async client=>{
      const job=await client.query('SELECT id FROM jobs WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,req.user.tenantId]);
      if(!job.rowCount) throw new BadRequestException('Work order was not found.');
      const entry=await client.query(`INSERT INTO job_labor_entries(tenant_id,job_id,employee_id,worked_on,minutes,description)
        VALUES($1,$2,$3,$4::date,$5,$6)
        RETURNING id,to_char(worked_on,'YYYY-MM-DD') AS "workedOn",minutes,description,created_at AS "createdAt"`,
      [req.user.tenantId,id,req.user.id,body.workedOn,body.minutes,description]);
      await client.query('INSERT INTO job_events(tenant_id,job_id,actor_id,event_type,details) VALUES($1,$2,$3,$4,$5)',
        [req.user.tenantId,id,req.user.id,'labor_logged',`${body.minutes} minutes · ${description}`]);
      return {...entry.rows[0],employeeId:req.user.id};
    });
  }
  @Post(':id/materials') async addMaterial(@Req() req:UserRequest,@Param('id') id:string,@Body() body:LogMaterialDto){
    requirePermission(req.user,'worklogs.write');
    return this.db.transaction(async client=>{
      const job=await client.query('SELECT id FROM jobs WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,req.user.tenantId]);
      if(!job.rowCount) throw new BadRequestException('Work order was not found.');
      let name=body.name?.trim()||'';
      let unit=body.unit?.trim()||'each';
      if(body.inventoryItemId){
        requirePermission(req.user,'inventory.read');
        const item=await client.query<{name:string;unit:string;stock_quantity:string}>('SELECT name,unit,stock_quantity FROM inventory_items WHERE id=$1 AND tenant_id=$2 AND active=true FOR UPDATE',[body.inventoryItemId,req.user.tenantId]);
        if(!item.rowCount) throw new BadRequestException('Select an active inventory item from your organization.');
        name=item.rows[0].name;
        unit=item.rows[0].unit;
        if(Number(item.rows[0].stock_quantity)<body.quantity) throw new BadRequestException(`Insufficient stock for ${name}. Available: ${item.rows[0].stock_quantity} ${unit}.`);
        await client.query('UPDATE inventory_items SET stock_quantity=stock_quantity-$3,updated_at=now() WHERE id=$1 AND tenant_id=$2',[body.inventoryItemId,req.user.tenantId,body.quantity]);
        await client.query(`INSERT INTO inventory_movements(tenant_id,item_id,actor_id,job_id,movement_type,quantity,notes)
          VALUES($1,$2,$3,$4,'work_order_use',$5,$6)`,[req.user.tenantId,body.inventoryItemId,req.user.id,id,-body.quantity,body.notes?.trim()||`Used on work order #${id}`]);
      }
      if(!name) throw new BadRequestException('Enter a part or material name.');
      if(!unit) throw new BadRequestException('Enter a unit for the quantity.');
      const entry=await client.query(`INSERT INTO job_material_entries(tenant_id,job_id,employee_id,used_on,inventory_item_id,name,quantity,unit,notes)
        VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9)
        RETURNING id,to_char(used_on,'YYYY-MM-DD') AS "usedOn",name,quantity::float8 AS quantity,unit,notes,created_at AS "createdAt"`,
      [req.user.tenantId,id,req.user.id,body.usedOn,body.inventoryItemId??null,name,body.quantity,unit,body.notes?.trim()||null]);
      await client.query('INSERT INTO job_events(tenant_id,job_id,actor_id,event_type,details) VALUES($1,$2,$3,$4,$5)',
        [req.user.tenantId,id,req.user.id,'material_logged',`${body.quantity} ${unit} · ${name}${body.notes?.trim()?` — ${body.notes.trim()}`:''}`]);
      return {...entry.rows[0],employeeId:req.user.id};
    });
  }
  @Get(':id/history') async history(@Req() req:UserRequest,@Param('id') id:string){
    requirePermission(req.user,'jobs.read');
    const job=await this.db.query('SELECT id FROM jobs WHERE id=$1 AND tenant_id=$2',[id,req.user.tenantId]);
    if(!job.rowCount) throw new BadRequestException('Job was not found.');
    const events=await this.db.query(`SELECT e.id,e.event_type AS "eventType",e.previous_value AS "previousValue",e.new_value AS "newValue",e.details,e.created_at AS "createdAt",actor.full_name AS "actorName",COALESCE(old_assignee.full_name,old_contractor.name) AS "previousAssignee",COALESCE(new_assignee.full_name,new_contractor.name) AS "newAssignee"
      FROM job_events e
      JOIN users actor ON actor.id=e.actor_id AND actor.tenant_id=e.tenant_id
      LEFT JOIN users old_assignee ON old_assignee.id=CASE WHEN e.event_type='assigned' AND e.previous_value IS NOT NULL THEN e.previous_value::uuid END AND old_assignee.tenant_id=e.tenant_id
      LEFT JOIN users new_assignee ON new_assignee.id=CASE WHEN e.event_type='assigned' AND e.new_value IS NOT NULL THEN e.new_value::uuid END AND new_assignee.tenant_id=e.tenant_id
      LEFT JOIN contractors old_contractor ON old_contractor.id=CASE WHEN e.event_type='contractor_assigned' AND e.previous_value IS NOT NULL THEN e.previous_value::uuid END AND old_contractor.tenant_id=e.tenant_id
      LEFT JOIN contractors new_contractor ON new_contractor.id=CASE WHEN e.event_type='contractor_assigned' AND e.new_value IS NOT NULL THEN e.new_value::uuid END AND new_contractor.tenant_id=e.tenant_id
      WHERE e.job_id=$1 AND e.tenant_id=$2 ORDER BY e.created_at DESC LIMIT 200`,[id,req.user.tenantId]);
    return events.rows;
  }
  @Patch(':id') async update(@Req() req:UserRequest,@Param('id') id:string,@Body() body:UpdateJobDto){
    requirePermission(req.user,'jobs.update');
    return this.db.transaction(async client=>{
      const current=await client.query<{status:string;status_reason:string|null;priority:string;assigned_to:string|null;contractor_id:string|null;preferred_date:string|null;scheduled_date:string|null;completion_notes:string|null;title:string;job_number:number;created_by:string}>("SELECT status,status_reason,priority,assigned_to,contractor_id,to_char(preferred_date,'YYYY-MM-DD') AS preferred_date,to_char(scheduled_date,'YYYY-MM-DD') AS scheduled_date,completion_notes,title,job_number,created_by FROM jobs WHERE id=$1 AND tenant_id=$2 FOR UPDATE",[id,req.user.tenantId]);
      const before=current.rows[0];if(!before) throw new BadRequestException('Job was not found.');
      if(body.assignedTo&&body.contractorId) throw new BadRequestException('A work order can be assigned to either an employee or a contractor, not both.');
      const assignmentProvided=body.assignedTo!==undefined||body.contractorId!==undefined;
      const nextAssignedTo=body.contractorId?null:body.assignedTo??(body.contractorId!==undefined?null:before.assigned_to);
      const nextContractorId=body.contractorId??(body.assignedTo!==undefined?null:before.contractor_id);
      const contractorAssignmentChanged=assignmentProvided&&nextContractorId!==before.contractor_id;
      const effectiveAssignmentChanged=assignmentProvided&&(nextAssignedTo!==before.assigned_to||contractorAssignmentChanged);
      const preferredDateChanged=body.preferredDate!==undefined&&body.preferredDate!==before.preferred_date;
      const scheduleChanged=body.scheduledDate!==undefined&&body.scheduledDate!==before.scheduled_date;
      const notes=body.completionNotes?.trim();
      const reason=body.statusReason?.trim();
      const statusChanged=body.status!==undefined&&body.status!==before.status;
      const effectiveStatus=body.status??before.status;
      const effectiveReason=statusChanged?(effectiveStatus==='on_hold'||effectiveStatus==='cancelled'?reason||null:null):(body.statusReason!==undefined?reason||null:before.status_reason);
      const reasonChanged=effectiveReason!==before.status_reason;
      const notesChanged=notes!==undefined&&notes!==before.completion_notes;
      const priorityChanged=body.priority!==undefined&&body.priority!==before.priority;
      if(!statusChanged&&!priorityChanged&&!effectiveAssignmentChanged&&!preferredDateChanged&&!scheduleChanged&&!notesChanged&&!reasonChanged) throw new BadRequestException('Provide a field to update.');
      if((effectiveStatus==='on_hold'||effectiveStatus==='cancelled')&&!effectiveReason) throw new BadRequestException(effectiveStatus==='on_hold'?'Enter a reason for putting this work order on hold.':'Enter a reason for cancelling this work order.');
      if(statusChanged&&effectiveStatus==='completed'&&!(notes||before.completion_notes?.trim())) throw new BadRequestException('Add completion details before completing this work order.');
      if(effectiveAssignmentChanged&&nextAssignedTo){const assignee=await client.query('SELECT id FROM users WHERE id=$1 AND tenant_id=$2 AND active=true',[nextAssignedTo,req.user.tenantId]);if(!assignee.rowCount) throw new BadRequestException('Select an active employee from your organization.');}
      if(effectiveAssignmentChanged&&nextContractorId){const contractor=await client.query('SELECT id FROM contractors WHERE id=$1 AND tenant_id=$2 AND active=true',[nextContractorId,req.user.tenantId]);if(!contractor.rowCount) throw new BadRequestException('Select an active contractor from your organization.');}
      const result=await client.query(`UPDATE jobs SET status=$3,priority=$4,assigned_to=CASE WHEN $5 THEN $6 ELSE assigned_to END,contractor_id=CASE WHEN $5 THEN $7 ELSE contractor_id END,preferred_date=CASE WHEN $8 THEN $9 ELSE preferred_date END,scheduled_date=CASE WHEN $10 THEN $11 ELSE scheduled_date END,completion_notes=COALESCE($12,completion_notes),status_reason=$13,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,job_number AS "jobNumber",status,status_reason AS "statusReason",priority,assigned_to AS "assignedTo",contractor_id AS "contractorId",to_char(preferred_date,'YYYY-MM-DD') AS "preferredDate",to_char(scheduled_date,'YYYY-MM-DD') AS "scheduledDate",completion_notes AS "completionNotes",updated_at AS "updatedAt"`,[id,req.user.tenantId,effectiveStatus,body.priority??before.priority,effectiveAssignmentChanged,nextAssignedTo,nextContractorId,preferredDateChanged,body.preferredDate??null,scheduleChanged,body.scheduledDate??null,notes??null,effectiveReason]);
      if(statusChanged&&effectiveStatus==='completed'){
        const maintenancePlan=await client.query<{id:string;max_completed_runs:number}>(
          `SELECT p.id,p.max_completed_runs FROM preventive_maintenance_runs r
           JOIN preventive_maintenance_plans p ON p.id=r.plan_id AND p.tenant_id=r.tenant_id
           WHERE r.job_id=$1 AND r.tenant_id=$2 FOR UPDATE OF p`,[id,req.user.tenantId]);
        const plan=maintenancePlan.rows[0];
        if(plan){
          await client.query('UPDATE preventive_maintenance_runs SET completed_at=COALESCE(completed_at,now()) WHERE job_id=$1 AND tenant_id=$2',[id,req.user.tenantId]);
          const completed=await client.query<{count:number}>(
            'SELECT count(*)::int AS count FROM preventive_maintenance_runs WHERE plan_id=$1 AND tenant_id=$2 AND completed_at IS NOT NULL',
            [plan.id,req.user.tenantId]);
          if(completed.rows[0]?.count>=plan.max_completed_runs){
            await client.query('UPDATE preventive_maintenance_plans SET active=false,updated_at=now() WHERE id=$1 AND tenant_id=$2',[plan.id,req.user.tenantId]);
          }
        }
      }
      const addEvent=async(type:string,previous:string|null,newValue:string|null,details:string|null=null)=>{await client.query('INSERT INTO job_events(tenant_id,job_id,actor_id,event_type,previous_value,new_value,details) VALUES($1,$2,$3,$4,$5,$6,$7)',[req.user.tenantId,id,req.user.id,type,previous,newValue,details]);};
      const notify=async(recipientId:string|null,type:string,title:string,message:string,eventType:string)=>{
        if(!recipientId||recipientId===req.user.id)return;
        const eventKey=`job:${id}:${eventType}:${result.rows[0].updatedAt}`;
        await client.query(`INSERT INTO notifications(tenant_id,user_id,event_key,notification_type,title,message,job_id)
          SELECT $1,u.id,$2,$3,$4,$5,$6 FROM users u WHERE u.id=$7 AND u.tenant_id=$1 AND u.active=true
          ON CONFLICT(tenant_id,user_id,event_key) DO NOTHING`,[req.user.tenantId,eventKey,type,title,message,id,recipientId]);
      };
      if(statusChanged) await addEvent('status_changed',before.status,effectiveStatus,effectiveReason);
      else if(reasonChanged) await addEvent('status_reason_changed',before.status_reason,effectiveReason);
      if(priorityChanged) await addEvent('priority_changed',before.priority,body.priority!);
      if(effectiveAssignmentChanged){
        if(before.assigned_to!==nextAssignedTo) await addEvent('assigned',before.assigned_to,nextAssignedTo);
        if(before.contractor_id!==nextContractorId) await addEvent('contractor_assigned',before.contractor_id,nextContractorId);
        if(nextAssignedTo) await notify(nextAssignedTo,'work_assigned','Work order assigned',`Work order #${String(before.job_number).padStart(5,'0')} · ${before.title} was assigned to you.`,'assigned');
      }
      if(preferredDateChanged) await addEvent('customer_date_updated',before.preferred_date,body.preferredDate??null);
      if(scheduleChanged){
        await addEvent('scheduled',before.scheduled_date,body.scheduledDate??null);
        const dateMessage=body.scheduledDate?`scheduled for ${body.scheduledDate}`:'removed from the schedule';
        const message=`Work order #${String(before.job_number).padStart(5,'0')} · ${before.title} was ${dateMessage}.`;
        await notify(result.rows[0].assignedTo??null,'schedule_changed','Work order schedule changed',message,'scheduled');
      }
      if(statusChanged){
        const statusMessage=`Work order #${String(before.job_number).padStart(5,'0')} · ${before.title} is now ${effectiveStatus.replaceAll('_',' ')}.`;
        await notify(before.created_by,effectiveStatus==='completed'?'work_completed':'work_status_changed',effectiveStatus==='completed'?'Work order completed':'Work order status changed',statusMessage,`status:${effectiveStatus}`);
        if(result.rows[0].assignedTo!==before.created_by) await notify(result.rows[0].assignedTo??null,effectiveStatus==='completed'?'work_completed':'work_status_changed',effectiveStatus==='completed'?'Work order completed':'Work order status changed',statusMessage,`status:${effectiveStatus}`);
      }
      if(notesChanged) await addEvent('work_notes_updated',null,null,notes||'Work notes cleared.');
      return result.rows[0];
    });
  }
}
