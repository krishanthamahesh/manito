import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthUser } from './auth.service';
import { DatabaseService } from './database.service';
import { requirePermission } from './authorization';
import { pageResult, parsePagination } from './pagination';

class CreateAssetDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  location!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

interface UserRequest extends Request {
  user: AuthUser;
}

@Controller('assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async list(
    @Req() req: UserRequest,
    @Query('customerId') customerId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ) {
    requirePermission(req.user,'equipment.read');
    const pagination=parsePagination(page,pageSize);
    const values: unknown[] = [req.user.tenantId];
    const filters = ['a.tenant_id = $1'];
    if (customerId) {
      values.push(customerId);
      filters.push(`a.customer_id = $${values.length}`);
    }
    if (search?.trim()) {
      values.push(`%${search.trim()}%`);
      filters.push(`(a.name ILIKE $${values.length} OR a.make ILIKE $${values.length} OR a.model ILIKE $${values.length} OR a.serial_number ILIKE $${values.length} OR c.full_name ILIKE $${values.length})`);
    }
    const from=`FROM assets a
       JOIN customers c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id`;
    const where=`WHERE ${filters.join(' AND ')}`;
    const count=await this.db.query<{total:string}>(`SELECT count(*)::text AS total ${from} ${where}`,values);
    const result = await this.db.query(
      `SELECT a.id, a.customer_id AS "customerId", c.full_name AS "customerName",
              a.name, a.make, a.model, a.serial_number AS "serialNumber", a.location,
              a.notes, a.created_at AS "createdAt",
              count(j.id)::int AS "jobCount",
              max(j.created_at) AS "lastServicedAt"
       ${from}
       LEFT JOIN jobs j ON j.asset_id = a.id AND j.tenant_id = a.tenant_id
       ${where}
       GROUP BY a.id, c.full_name
       ORDER BY lower(a.name),a.id
       LIMIT $${values.length+1} OFFSET $${values.length+2}`,
      [...values,pagination.pageSize,pagination.offset]
    );
    return pageResult(result.rows,Number(count.rows[0].total),pagination.page,pagination.pageSize);
  }

  @Get(':id/history')
  async history(@Req() req: UserRequest, @Param('id') id: string) {
    requirePermission(req.user,'equipment.read');
    const asset = await this.db.query(
      `SELECT a.id, a.customer_id AS "customerId", c.full_name AS "customerName",
              a.name, a.make, a.model, a.serial_number AS "serialNumber", a.location, a.notes
       FROM assets a
       JOIN customers c ON c.id = a.customer_id AND c.tenant_id = a.tenant_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [id, req.user.tenantId]
    );
    if (!asset.rowCount) throw new NotFoundException('Equipment was not found.');

    const jobs = await this.db.query(
      `SELECT j.id, j.job_number AS "jobNumber", j.title, j.description,
              j.contact_channel AS "contactChannel", j.equipment_description AS "equipmentDescription",
              j.asset_id AS "assetId", a.name AS "assetName", a.make AS "assetMake",
              a.model AS "assetModel", a.serial_number AS "assetSerialNumber",
              j.location, j.reported_urgency AS "reportedUrgency", j.priority,
              to_char(j.preferred_date,'YYYY-MM-DD') AS "preferredDate",
              to_char(j.scheduled_date,'YYYY-MM-DD') AS "scheduledDate",
              j.status, j.status_reason AS "statusReason",
              j.created_at AS "createdAt", j.completion_notes AS "completionNotes",
              j.assigned_to AS "assignedTo", assigned.full_name AS "assignedName",
              c.id AS "customerId", c.full_name AS "customerName", c.phone AS "customerPhone",
              creator.full_name AS "createdBy"
       FROM jobs j
       JOIN users creator ON creator.id = j.created_by
       JOIN customers c ON c.id = j.customer_id AND c.tenant_id = j.tenant_id
       LEFT JOIN users assigned ON assigned.id = j.assigned_to AND assigned.tenant_id = j.tenant_id
       LEFT JOIN assets a ON a.id = j.asset_id AND a.tenant_id = j.tenant_id
       WHERE j.asset_id = $1 AND j.tenant_id = $2
       ORDER BY j.created_at DESC
       LIMIT 200`,
      [id, req.user.tenantId]
    );
    return { asset: asset.rows[0], jobs: jobs.rows };
  }

  @Post()
  async create(@Req() req: UserRequest, @Body() body: CreateAssetDto) {
    requirePermission(req.user,'equipment.write');
    const customer = await this.db.query(
      'SELECT id FROM customers WHERE id = $1 AND tenant_id = $2',
      [body.customerId, req.user.tenantId]
    );
    if (!customer.rowCount) {
      throw new BadRequestException('Select a customer from your organization.');
    }
    const result = await this.db.query(
      `INSERT INTO assets (tenant_id, customer_id, name, make, model, serial_number, location, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, customer_id AS "customerId", name, make, model,
                 serial_number AS "serialNumber", location, notes, created_at AS "createdAt"`,
      [
        req.user.tenantId,
        body.customerId,
        body.name.trim(),
        body.make?.trim() || null,
        body.model?.trim() || null,
        body.serialNumber?.trim() || null,
        body.location.trim(),
        body.notes?.trim() || null
      ]
    );
    return result.rows[0];
  }
}
