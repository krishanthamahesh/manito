import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import * as bcrypt from 'bcryptjs';
import { BUILT_IN_ROLES } from './permissions';
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool = new Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.DB_POOL_MAX??10)});
  async initialize(): Promise<void> {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS tenants(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE, address TEXT, contact_phone TEXT, technical_contact_phone TEXT, contact_email TEXT, time_zone TEXT NOT NULL DEFAULT 'UTC', phone_intake_enabled BOOLEAN NOT NULL DEFAULT true, walk_in_intake_enabled BOOLEAN NOT NULL DEFAULT true, color_theme TEXT NOT NULL DEFAULT 'green', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_phone TEXT;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS technical_contact_phone TEXT;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS contact_email TEXT;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'UTC';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS phone_intake_enabled BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS walk_in_intake_enabled BOOLEAN NOT NULL DEFAULT true;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS color_theme TEXT NOT NULL DEFAULT 'green';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo BYTEA;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_content_type TEXT;
      CREATE TABLE IF NOT EXISTS users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), email TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'employee' CHECK(role IN ('employee','manager','admin')), active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(tenant_id,email));
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture BYTEA;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture_content_type TEXT;
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID;
      CREATE TABLE IF NOT EXISTS roles(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        role_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_role TEXT,
        permissions TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(id,tenant_id),
        UNIQUE(tenant_id,role_key),
        UNIQUE(tenant_id,system_role)
      );
      CREATE INDEX IF NOT EXISTS roles_tenant_name_idx ON roles(tenant_id,lower(name));
      CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_unique_name_idx ON roles(tenant_id,lower(name));
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_scope_fk' AND conrelid='users'::regclass) THEN
          ALTER TABLE users ADD CONSTRAINT users_role_scope_fk
            FOREIGN KEY(role_id,tenant_id) REFERENCES roles(id,tenant_id);
        END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS customers(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), full_name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(phone IS NOT NULL OR email IS NOT NULL));
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
      DO $$ BEGIN
        IF to_regclass('customer_locations') IS NOT NULL THEN
          UPDATE customers c SET address=legacy.address
          FROM (
            SELECT DISTINCT ON (customer_id) customer_id,address
            FROM customer_locations
            ORDER BY customer_id,active DESC,created_at,id
          ) legacy
          WHERE c.id=legacy.customer_id AND c.address IS NULL;
        END IF;
      END $$;
      CREATE INDEX IF NOT EXISTS customers_tenant_name_idx ON customers(tenant_id,lower(full_name));
      CREATE TABLE IF NOT EXISTS organization_locations(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(id,tenant_id)
      );
      CREATE INDEX IF NOT EXISTS organization_locations_tenant_active_name_idx ON organization_locations(tenant_id,active,lower(name));
      CREATE TABLE IF NOT EXISTS contractors(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        notes TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(id,tenant_id)
      );
      CREATE INDEX IF NOT EXISTS contractors_tenant_active_name_idx ON contractors(tenant_id,active,lower(name));
      CREATE TABLE IF NOT EXISTS assets(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        customer_id UUID NOT NULL REFERENCES customers(id),
        name TEXT NOT NULL,
        make TEXT,
        model TEXT,
        serial_number TEXT,
        location TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS assets_tenant_customer_idx ON assets(tenant_id,customer_id,lower(name));
      CREATE TABLE IF NOT EXISTS jobs(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), customer_id UUID NOT NULL REFERENCES customers(id), created_by UUID NOT NULL REFERENCES users(id), job_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL, contact_channel TEXT NOT NULL CHECK(contact_channel IN ('phone','walk_in','preventive')), equipment_description TEXT, location TEXT NOT NULL, reported_urgency TEXT NOT NULL CHECK(reported_urgency IN ('low','normal','urgent')), priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')), preferred_date DATE, status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','under_review','awaiting_customer','accepted','assigned','in_progress','on_hold','completed','cancelled')), completion_notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid='jobs'::regclass AND conname='jobs_contact_channel_check'
            AND pg_get_constraintdef(oid) LIKE '%preventive%'
        ) THEN
          ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_contact_channel_check;
          ALTER TABLE jobs ADD CONSTRAINT jobs_contact_channel_check CHECK(contact_channel IN ('phone','walk_in','preventive'));
        END IF;
      END $$;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES assets(id);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contractor_id UUID;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_contractor_scope_fk' AND conrelid='jobs'::regclass) THEN
          ALTER TABLE jobs ADD CONSTRAINT jobs_contractor_scope_fk
            FOREIGN KEY(contractor_id,tenant_id)
            REFERENCES contractors(id,tenant_id);
        END IF;
      END $$;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS organization_location_id UUID;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='jobs_organization_location_scope_fk' AND conrelid='jobs'::regclass) THEN
          ALTER TABLE jobs ADD CONSTRAINT jobs_organization_location_scope_fk
            FOREIGN KEY(organization_location_id,tenant_id)
            REFERENCES organization_locations(id,tenant_id);
        END IF;
      END $$;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status_reason TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_date DATE;
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_job_number_unique_idx ON jobs(job_number);
      CREATE INDEX IF NOT EXISTS jobs_tenant_created_idx ON jobs(tenant_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS jobs_tenant_status_idx ON jobs(tenant_id,status);
      CREATE TABLE IF NOT EXISTS job_attachments(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        uploaded_by UUID NOT NULL REFERENCES users(id),
        original_name TEXT NOT NULL,
        content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
        file_size INTEGER NOT NULL CHECK(file_size BETWEEN 1 AND 8388608),
        content BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS job_attachments_tenant_job_created_idx ON job_attachments(tenant_id,job_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS job_events(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id), job_id UUID NOT NULL REFERENCES jobs(id), actor_id UUID NOT NULL REFERENCES users(id), event_type TEXT NOT NULL, previous_value TEXT, new_value TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE job_events ADD COLUMN IF NOT EXISTS details TEXT;
      CREATE INDEX IF NOT EXISTS job_events_tenant_job_created_idx ON job_events(tenant_id,job_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS job_labor_entries(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        job_id UUID NOT NULL REFERENCES jobs(id),
        employee_id UUID NOT NULL REFERENCES users(id),
        worked_on DATE NOT NULL DEFAULT CURRENT_DATE,
        minutes INTEGER NOT NULL CHECK(minutes > 0 AND minutes <= 1440),
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS job_labor_tenant_job_idx ON job_labor_entries(tenant_id,job_id,worked_on DESC,created_at DESC);
      CREATE TABLE IF NOT EXISTS job_material_entries(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        job_id UUID NOT NULL REFERENCES jobs(id),
        employee_id UUID NOT NULL REFERENCES users(id),
        used_on DATE NOT NULL DEFAULT CURRENT_DATE,
        name TEXT NOT NULL,
        quantity NUMERIC(12,3) NOT NULL CHECK(quantity > 0),
        unit TEXT NOT NULL DEFAULT 'each',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS job_material_tenant_job_idx ON job_material_entries(tenant_id,job_id,used_on DESC,created_at DESC);
      CREATE TABLE IF NOT EXISTS inventory_vendors(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        notes TEXT,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(id,tenant_id)
      );
      CREATE INDEX IF NOT EXISTS inventory_vendors_tenant_name_idx ON inventory_vendors(tenant_id,active,lower(name));
      CREATE TABLE IF NOT EXISTS inventory_brands(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(id,tenant_id),
        UNIQUE(tenant_id,name)
      );
      CREATE INDEX IF NOT EXISTS inventory_brands_tenant_name_idx ON inventory_brands(tenant_id,active,lower(name));
      CREATE TABLE IF NOT EXISTS inventory_items(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        vendor_id UUID,
        brand_id UUID,
        sku TEXT NOT NULL,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'each',
        stock_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
        reorder_level NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK(reorder_level >= 0),
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(tenant_id,sku)
      );
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS vendor_id UUID;
      ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS brand_id UUID;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_items_vendor_scope_fk' AND conrelid='inventory_items'::regclass) THEN
          ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_vendor_scope_fk
            FOREIGN KEY(vendor_id,tenant_id) REFERENCES inventory_vendors(id,tenant_id);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_items_brand_scope_fk' AND conrelid='inventory_items'::regclass) THEN
          ALTER TABLE inventory_items ADD CONSTRAINT inventory_items_brand_scope_fk
            FOREIGN KEY(brand_id,tenant_id) REFERENCES inventory_brands(id,tenant_id);
        END IF;
      END $$;
      ALTER TABLE job_material_entries ADD COLUMN IF NOT EXISTS inventory_item_id UUID REFERENCES inventory_items(id);
      CREATE INDEX IF NOT EXISTS inventory_tenant_name_idx ON inventory_items(tenant_id,lower(name));
      CREATE TABLE IF NOT EXISTS inventory_movements(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        item_id UUID NOT NULL REFERENCES inventory_items(id),
        actor_id UUID NOT NULL REFERENCES users(id),
        job_id UUID REFERENCES jobs(id),
        movement_type TEXT NOT NULL CHECK(movement_type IN ('receipt','adjustment','work_order_use')),
        quantity NUMERIC(12,3) NOT NULL CHECK(quantity <> 0),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS inventory_movements_tenant_item_idx ON inventory_movements(tenant_id,item_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS preventive_maintenance_plans(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        asset_id UUID NOT NULL REFERENCES assets(id),
        created_by UUID NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        interval_days INTEGER NOT NULL CHECK(interval_days BETWEEN 1 AND 36500),
        next_due_date DATE NOT NULL,
        max_completed_runs INTEGER NOT NULL DEFAULT 4 CHECK(max_completed_runs BETWEEN 1 AND 10000),
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE preventive_maintenance_plans ADD COLUMN IF NOT EXISTS max_completed_runs INTEGER NOT NULL DEFAULT 4 CHECK(max_completed_runs BETWEEN 1 AND 10000);
      CREATE INDEX IF NOT EXISTS preventive_maintenance_due_idx ON preventive_maintenance_plans(tenant_id,next_due_date) WHERE active=true;
      CREATE TABLE IF NOT EXISTS preventive_maintenance_runs(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        plan_id UUID NOT NULL REFERENCES preventive_maintenance_plans(id),
        due_date DATE NOT NULL,
        job_id UUID NOT NULL REFERENCES jobs(id),
        actor_id UUID NOT NULL REFERENCES users(id),
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(plan_id,due_date),
        UNIQUE(job_id)
      );
      ALTER TABLE preventive_maintenance_runs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
      UPDATE preventive_maintenance_runs r SET completed_at=j.updated_at
      FROM jobs j WHERE j.id=r.job_id AND j.tenant_id=r.tenant_id AND j.status='completed' AND r.completed_at IS NULL;
      UPDATE preventive_maintenance_plans p SET active=false,updated_at=now()
      WHERE p.active=true AND (SELECT count(*) FROM preventive_maintenance_runs r
        WHERE r.plan_id=p.id AND r.tenant_id=p.tenant_id AND r.completed_at IS NOT NULL)>=p.max_completed_runs;
      CREATE INDEX IF NOT EXISTS preventive_maintenance_runs_tenant_plan_idx ON preventive_maintenance_runs(tenant_id,plan_id,due_date DESC);
      CREATE TABLE IF NOT EXISTS notifications(
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id),
        user_id UUID NOT NULL REFERENCES users(id),
        event_key TEXT NOT NULL,
        notification_type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        job_id UUID REFERENCES jobs(id),
        is_read BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at TIMESTAMPTZ,
        UNIQUE(tenant_id,user_id,event_key)
      );
      CREATE INDEX IF NOT EXISTS notifications_user_inbox_idx ON notifications(tenant_id,user_id,is_read,created_at DESC);
    `);
    const existingTenants=await this.pool.query<{id:string}>('SELECT id FROM tenants');
    for(const tenant of existingTenants.rows) await this.seedBuiltInRoles(tenant.id);
    await this.pool.query(`UPDATE users u SET role_id=r.id
      FROM roles r WHERE u.role_id IS NULL AND r.tenant_id=u.tenant_id AND r.system_role=u.role`);
    await this.pool.query('ALTER TABLE users ALTER COLUMN role_id SET NOT NULL');
    const email=process.env.ADMIN_EMAIL?.trim().toLowerCase(); const password=process.env.ADMIN_PASSWORD;
    if (!email && !password) return;
    if (!email || !password || password.length<12) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) must both be configured.');
    const existing=await this.pool.query<{tenant_id:string}>('SELECT tenant_id FROM users WHERE email=$1',[email]);
    if(existing.rowCount) return;
    const name=process.env.ORGANIZATION_NAME?.trim()||'Manito Shop';
    const tenant=await this.pool.query<{id:string}>(`INSERT INTO tenants(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[name]);
    const tenantId=tenant.rows[0]?.id; if(!tenantId) throw new Error('Unable to initialize organization.');
    await this.seedBuiltInRoles(tenantId);
    const hash=await bcrypt.hash(password,12);
    await this.pool.query(`INSERT INTO users(tenant_id,email,full_name,password_hash,role,role_id)
      VALUES($1,$2,$3,$4,'admin',(SELECT id FROM roles WHERE tenant_id=$1 AND system_role='admin'))`,
    [tenantId,email,process.env.ADMIN_NAME?.trim()||'Administrator',hash]);
  }
  private async seedBuiltInRoles(tenantId:string):Promise<void>{
    for(const role of BUILT_IN_ROLES){
      await this.pool.query(`INSERT INTO roles(tenant_id,role_key,name,description,system_role,permissions)
        VALUES($1,$2,$3,$4,$2,$5)
        ON CONFLICT(tenant_id,role_key) DO UPDATE SET
          name=EXCLUDED.name,description=EXCLUDED.description,system_role=EXCLUDED.system_role,
          permissions=EXCLUDED.permissions,updated_at=now()`,
      [tenantId,role.key,role.name,role.description,[...role.permissions]]);
    }
  }
  query<T extends QueryResultRow=QueryResultRow>(text:string,values:unknown[]=[]):Promise<QueryResult<T>> { return this.pool.query<T>(text,values); }
  async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');
      const result=await work(client);
      await client.query('COMMIT');
      return result;
    }catch(error){
      await client.query('ROLLBACK');
      throw error;
    }finally{
      client.release();
    }
  }
  async onModuleDestroy():Promise<void>{await this.pool.end();}
}
